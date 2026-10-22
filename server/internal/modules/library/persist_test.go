package library_test

import (
	"context"
	"slices"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// AlbumArtistNames fallback ladder: tagged album artist wins; a file with
// several track artists and no album-artist tag is a compilation and groups
// under Various Artists; a single-artist file keeps the track-artist
// fallback so ordinary untagged-album-artist albums are unaffected.
func TestAlbumArtistNames(t *testing.T) {
	meta := func(albumArtists []string, albumArtist string, artists ...string) *audio.Metadata {
		return &audio.Metadata{AlbumArtists: albumArtists, AlbumArtist: albumArtist, Artists: artists}
	}
	cases := []struct {
		name string
		meta *audio.Metadata
		song []string
		want []string
	}{
		{"multi-value tag wins", meta([]string{"Tag A", "Tag B"}, "", "X", "Y"), []string{"X", "Y"}, []string{"Tag A", "Tag B"}},
		{"single tag wins", meta(nil, "Tag A", "X"), []string{"X"}, []string{"Tag A"}},
		{"multi-artist fallback is Various Artists", meta(nil, "", "X", "Y"), []string{"X", "Y"}, []string{library.VariousArtists}},
		{"single artist keeps track fallback", meta(nil, "", "X"), []string{"X"}, []string{"X"}},
		{"no artists at all", meta(nil, "", ""), nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := library.AlbumArtistNames(tc.meta, tc.song)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("AlbumArtistNames = %v, want %v", got, tc.want)
			}
		})
	}
}

// An empty GENRE tag field ("" in the file's tag list) must not fail the
// import: it is the absence of a genre, not a genre. Files carrying one were
// permanently unimportable before the deep-scan backfill surfaced it (930 live
// rows, all inactive for exactly this reason).
func TestPersistSkipsEmptyGenreNames(t *testing.T) {
	database := openDB(t)
	ctx := context.Background()
	libID := "lib-empty-genre"
	addLibrary(t, database, libID, t.TempDir())

	meta := &audio.Metadata{
		Title: "Song", Artists: []string{"Artist"}, Album: "Album",
		AlbumArtists: []string{"Artist"}, Genres: []string{""}, Year: 2025,
	}
	if _, err := library.PersistSong(ctx, database, library.PersistInput{
		Path: "/lib/empty-genre.flac", Meta: meta, Mtime: 1, Checksum: "sum", LibraryID: &libID,
	}); err != nil {
		t.Fatalf("persist with empty genre tag: %v", err)
	}
	var genre *string
	if err := database.QueryRow(`SELECT genre FROM songs WHERE file_path = '/lib/empty-genre.flac'`).Scan(&genre); err != nil {
		t.Fatalf("song row: %v", err)
	}
	if genre != nil && *genre != "" {
		t.Fatalf("genre = %q, want NULL", *genre)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM song_genres WHERE song_id = (SELECT id FROM songs WHERE file_path = '/lib/empty-genre.flac')`); got != 0 {
		t.Fatalf("song_genres rows = %d, want 0", got)
	}
}

// Artist spellings that resolve to one artist row (the tag reader splits a
// featured-artist string whose parts differ only by case, e.g. "Niño De
// Elche" vs "Niño de Elche") must not double-insert the junction row — the
// (song_id, artist_id) UNIQUE fails the whole import (one live Macaco track
// sat unimportable for exactly this).
func TestPersistDeduplicatesResolvedArtistRows(t *testing.T) {
	database := openDB(t)
	ctx := context.Background()
	libID := "lib-dedupe-artists"
	addLibrary(t, database, libID, t.TempDir())

	meta := &audio.Metadata{
		Title: "Song", Album: "Album", AlbumArtists: []string{"Macaco"},
		Artists: []string{"Niño De Elche", "Niño de Elche", "Macaco"},
	}
	if _, err := library.PersistSong(ctx, database, library.PersistInput{
		Path: "/lib/dedupe.flac", Meta: meta, Mtime: 1, Checksum: "sum", LibraryID: &libID,
	}); err != nil {
		t.Fatalf("persist with case-variant duplicate artists: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM song_artists WHERE song_id = (SELECT id FROM songs WHERE file_path = '/lib/dedupe.flac')`); got != 2 {
		t.Fatalf("song_artists rows = %d, want 2 (Niño de Elche once + Macaco)", got)
	}
}

// The cached albums.genre column is written on album creation only; a later
// persist of a tagged file of an existing genreless album must backfill it
// (tags are the source of truth), while a user-set genre is never overwritten.
func TestPersistBackfillsAlbumGenre(t *testing.T) {
	database := openDB(t)
	ctx := context.Background()
	libID := "lib-genre-backfill"
	addLibrary(t, database, libID, t.TempDir())

	meta := func(genres ...string) *audio.Metadata {
		return &audio.Metadata{
			Title: "Track", Artists: []string{"Artist"}, Album: "Album",
			AlbumArtists: []string{"Artist"}, Genres: genres, Year: 2025,
		}
	}
	persist := func(path string, m *audio.Metadata) {
		t.Helper()
		if _, err := library.PersistSong(ctx, database, library.PersistInput{
			Path: path, Meta: m, Mtime: 1, Checksum: path, LibraryID: &libID,
		}); err != nil {
			t.Fatalf("persist %s: %v", path, err)
		}
	}
	albumGenre := func() string {
		t.Helper()
		var genre string
		if err := database.QueryRow(`SELECT genre FROM albums`).Scan(&genre); err != nil {
			t.Fatalf("album genre: %v", err)
		}
		return genre
	}

	persist("/lib/01-song.flac", meta())
	if got := countRows(t, database, `SELECT COUNT(1) FROM albums WHERE genre IS NULL`); got != 1 {
		t.Fatalf("album should start genreless, got %d genreless albums", got)
	}

	// A later-tagged file of the same album backfills the cached genre.
	persist("/lib/02-song.flac", meta("Jazz"))
	if got := albumGenre(); got != "Jazz" {
		t.Fatalf("album genre = %q, want backfilled Jazz", got)
	}

	// A user edit wins over tag values on subsequent persists.
	if _, err := database.Exec(`UPDATE albums SET genre = 'Rock' WHERE name = 'Album'`); err != nil {
		t.Fatalf("user edit: %v", err)
	}
	persist("/lib/03-song.flac", meta("Jazz"))
	if got := albumGenre(); got != "Rock" {
		t.Fatalf("album genre = %q, want user edit Rock preserved", got)
	}
}
