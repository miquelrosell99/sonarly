package taggenres_test

// taggenres tests: the mapping cascade, the plan query, and the apply flow
// (fake writer for the write+persist wiring; the real mutagen round-trip is
// guarded like the audio writer suite). The corpus file is copied into a
// temp dir so PersistSong has a real file to re-read.

import (
	"context"
	"database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/taggenres"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// seedSong inserts one active song plus its artist/album rows; genre empty
// mirrors a file without a genre tag.
func seedSong(t *testing.T, database *sql.DB, id, path, title, artist, album, albumArtist, genre string) {
	t.Helper()
	mustExec(t, database, `INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)`, "ar-"+artist, artist)
	mustExec(t, database, `INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)`, "ar-"+albumArtist, albumArtist)
	mustExec(t, database, `INSERT OR IGNORE INTO albums (id, name, artist_id, artist_name) VALUES (?, ?, ?, ?)`, "al-"+album, album, "ar-"+albumArtist, albumArtist)
	mustExec(t, database,
		`INSERT INTO songs (id, title, file_path, artist_id, album_id, genre, active, mtime, checksum)
		 VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
		id, title, path, "ar-"+artist, "al-"+album, genre, "sum-"+id)
}

func mustExec(t *testing.T, database *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := database.Exec(query, args...); err != nil {
		t.Fatalf("exec %s: %v", query, err)
	}
}

func TestResolveCascade(t *testing.T) {
	m := &taggenres.Mapping{
		Artists: map[string]string{"taylor swift": "Pop"},
		Albums:  map[string]string{"disney love songs": "Soundtrack"},
	}
	cases := []struct {
		name        string
		artist      string
		albumArtist string
		album       string
		wantGenre   string
		wantSource  string
		wantOK      bool
	}{
		{"song artist wins", "Taylor Swift", "", "X", "Pop", taggenres.SourceArtist, true},
		{"song artist case-insensitive", "TAYLOR SWIFT", "", "X", "Pop", taggenres.SourceArtist, true},
		{"album artist fallback", "Some Cast", "Taylor Swift", "X", "Pop", taggenres.SourceAlbumArtist, true},
		{"album name fallback", "Meryl Streep", "Various Artists", "Disney Love Songs", "Soundtrack", taggenres.SourceAlbum, true},
		{"no match", "Nobody", "Various Artists", "Unknown Album", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			genre, source, ok := m.Resolve(tc.artist, tc.albumArtist, tc.album)
			if ok != tc.wantOK || genre != tc.wantGenre || source != tc.wantSource {
				t.Fatalf("Resolve = (%q, %q, %v), want (%q, %q, %v)", genre, source, ok, tc.wantGenre, tc.wantSource, tc.wantOK)
			}
		})
	}
}

// fakeWriter records writes without touching the file — file mutation is the
// audio writer's own suite.
type fakeWriter struct {
	calls []struct {
		Path string
		Tags audio.SongTags
	}
}

func (f *fakeWriter) Supports(string) bool { return true }
func (f *fakeWriter) Write(_ context.Context, path string, tags audio.SongTags) error {
	f.calls = append(f.calls, struct {
		Path string
		Tags audio.SongTags
	}{path, tags})
	return nil
}

func TestPlanResolvesAndReportsUnresolved(t *testing.T) {
	database := openDB(t)
	seedSong(t, database, "s1", "/m/01.flac", "Shake It Off", "Taylor Swift", "1989", "Taylor Swift", "")
	seedSong(t, database, "s2", "/m/02.flac", "The Winner Takes It All", "Meryl Streep", "Mamma Mia!", "Cast of Mamma Mia! The Movie", "")
	seedSong(t, database, "s3", "/m/03.flac", "Already Tagged", "Taylor Swift", "1989", "Taylor Swift", "Pop")

	m := &taggenres.Mapping{Artists: map[string]string{"taylor swift": "Pop"}}
	plan, err := taggenres.Build(context.Background(), database, m)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if len(plan.Targets) != 1 || plan.Targets[0].SongID != "s1" || plan.Targets[0].Genre != "Pop" {
		t.Fatalf("targets = %+v, want only s1 -> Pop", plan.Targets)
	}
	if len(plan.Unresolved) != 1 || plan.Unresolved[0].Artist != "Meryl Streep" {
		t.Fatalf("unresolved = %+v, want Meryl Streep", plan.Unresolved)
	}
}

func corpusCopy(t *testing.T, dir, src, dst string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("../../audio/testdata/corpus", src))
	if err != nil {
		t.Fatalf("read corpus file %s: %v", src, err)
	}
	path := filepath.Join(dir, dst)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

// Apply end-to-end with the real mutagen writer: the genre lands in the
// file, the song row and genre junction update through PersistSong, and the
// album's cached genre backfills via the ensureAlbum fill.
func TestApplyWritesFileAndPersists(t *testing.T) {
	if !mutagenAvailable() {
		t.Skip("python3+mutagen not available on this host")
	}
	database := openDB(t)
	dir := t.TempDir()
	libID := "lib"
	mustExec(t, database,
		`INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		libID, libID, dir)

	path := corpusCopy(t, dir, "spike.flac", "01-spike.flac")
	seedSong(t, database, "s1", path, "Spike Song", "Spike Artist One", "Spike Album", "Spike Album Artist", "")

	m := &taggenres.Mapping{Artists: map[string]string{"spike album artist": "Jazz"}}
	plan, err := taggenres.Build(context.Background(), database, m)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if len(plan.Targets) != 1 {
		t.Fatalf("targets = %d, want 1", len(plan.Targets))
	}

	written, failed := taggenres.Apply(context.Background(), database, audio.NewMutagenWriter(), plan)
	if len(failed) > 0 {
		t.Fatalf("failed: %v", failed[0])
	}
	if len(written) != 1 {
		t.Fatalf("written = %d, want 1", len(written))
	}

	meta, err := audio.ReadMetadata(path)
	if err != nil {
		t.Fatalf("re-read metadata: %v", err)
	}
	if len(meta.Genres) != 1 || meta.Genres[0] != "Jazz" {
		t.Fatalf("file genres = %v, want [Jazz]", meta.Genres)
	}
	var songGenre string
	if err := database.QueryRow(`SELECT genre FROM songs WHERE id = 's1'`).Scan(&songGenre); err != nil {
		t.Fatalf("song genre: %v", err)
	}
	if songGenre != "Jazz" {
		t.Fatalf("song genre = %q, want Jazz", songGenre)
	}
	if n := countRows(t, database, `SELECT COUNT(1) FROM song_genres WHERE song_id = 's1'`); n != 1 {
		t.Fatalf("song_genres rows = %d, want 1", n)
	}
	var albumGenre string
	if err := database.QueryRow(`SELECT genre FROM albums WHERE name = 'Spike Album'`).Scan(&albumGenre); err != nil {
		t.Fatalf("album genre: %v", err)
	}
	if albumGenre != "Jazz" {
		t.Fatalf("album genre = %q, want backfilled Jazz", albumGenre)
	}
	if n := countRows(t, database, `SELECT COUNT(1) FROM genres WHERE name = 'Jazz'`); n != 1 {
		t.Fatalf("genres rows = %d, want 1", n)
	}
}

// One bad file must not abort the run: the remaining targets still write.
func TestApplyCollectsFailures(t *testing.T) {
	database := openDB(t)
	seedSong(t, database, "s1", "/m/gone.flac", "Missing", "Taylor Swift", "1989", "Taylor Swift", "")
	seedSong(t, database, "s2", "/m/also-gone.flac", "Missing 2", "Taylor Swift", "1989", "Taylor Swift", "")

	m := &taggenres.Mapping{Artists: map[string]string{"taylor swift": "Pop"}}
	plan, err := taggenres.Build(context.Background(), database, m)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	written, failed := taggenres.Apply(context.Background(), database, &fakeWriter{}, plan)
	if len(written) != 0 || len(failed) != 2 {
		t.Fatalf("written = %d, failed = %d, want 0/2", len(written), len(failed))
	}
}

func countRows(t *testing.T, database *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := database.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return n
}

func mutagenAvailable() bool {
	return exec.Command("python3", "-c", "import mutagen").Run() == nil
}
