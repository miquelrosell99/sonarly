package opensubsonic

import (
	"database/sql"
	"fmt"
	"testing"
)

// seed_test.go builds the multi-library content world the P9a endpoint
// tests run against: two libraries, a scoped non-admin (lib-a only), an
// admin, artists/albums/songs/genres/cover art in both libraries, and the
// per-user interaction rows the serializers gate on.

// catalogIDs names the fixture entities so tests read declaratively.
type catalogIDs struct {
	LibA, LibB   string
	Alice, Admin string
	ArBeatles    string
	ArBowie      string
	ArZappa      string // no albums, name starts with a digit-test char? no: '#' bucket test
	AlAbbey      string
	AlLow        string
	AlZiggy      string
	GRock, GPop  string
	SAbbey1      string
	SAbbey2      string
	SLow1        string
	SZiggy1      string
	CoverAbbey   string
	FileAbbey1   string
	FileLow1     string
}

// seedCatalog inserts the standard fixture. fileDir is the library root the
// song file paths live under (temp dir per test); pass "" to keep file_path
// values purely synthetic (browsing tests never stat them).
func (a *testApp) seedCatalog(t *testing.T, fileDir string) catalogIDs {
	t.Helper()
	c := catalogIDs{
		LibA: "lib-a", LibB: "lib-b",
		Alice: testUserID, Admin: "user-admin",
		ArBeatles: "ar-beatles", ArBowie: "ar-bowie", ArZappa: "ar-10cc",
		AlAbbey: "al-abbey", AlLow: "al-low", AlZiggy: "al-ziggy",
		GRock: "g-rock", GPop: "g-pop",
		SAbbey1: "s-abbey-1", SAbbey2: "s-abbey-2",
		SLow1: "s-low-1", SZiggy1: "s-ziggy-1",
		CoverAbbey: "ca-abbey",
		FileAbbey1: fileDir + "/beatles/abbey/01-ComeTogether.mp3",
		FileLow1:   fileDir + "/bowie/low/01-SpeedOfLife.mp3",
	}
	a.seedLibrary(t, c.LibA, "Alpha")
	a.seedLibrary(t, c.LibB, "Beta")
	a.seedUser(t, c.Admin, "root", "adminpass", true)
	a.assignLibrary(t, c.Alice, c.LibA)

	a.seedArtist(t, c.ArBeatles, "The Beatles")
	a.seedArtist(t, c.ArBowie, "David Bowie")
	a.seedArtist(t, c.ArZappa, "10cc")

	a.seedAlbum(t, c.AlAbbey, "Abbey Road", c.ArBeatles, 1969)
	a.seedAlbum(t, c.AlLow, "Low", c.ArBowie, 1977)
	a.seedAlbum(t, c.AlZiggy, "The Rise and Fall of Ziggy Stardust", c.ArBowie, 1972)

	a.seedGenre(t, c.GRock, "Rock")
	a.seedGenre(t, c.GPop, "Pop")

	a.seedSong(t, songSeed{
		ID: c.SAbbey1, Title: "Come Together", AlbumID: c.AlAbbey, ArtistID: c.ArBeatles,
		LibraryID: c.LibA, Track: 1, Disc: 1, Year: 1969, Duration: 259, Mtime: 1700000000000,
		FilePath: c.FileAbbey1, BitRate: 320000, Genre: "Rock", MediaType: "audio/mpeg",
	})
	a.seedSong(t, songSeed{
		ID: c.SAbbey2, Title: "Something", AlbumID: c.AlAbbey, ArtistID: c.ArBeatles,
		LibraryID: c.LibA, Track: 2, Disc: 1, Year: 1969, Duration: 182, Mtime: 1700000001000,
		FilePath: fileDir + "/beatles/abbey/02-Something.mp3", BitRate: 320000, Genre: "Rock",
	})
	a.seedSong(t, songSeed{
		ID: c.SLow1, Title: "Speed of Life", AlbumID: c.AlLow, ArtistID: c.ArBowie,
		LibraryID: c.LibB, Track: 1, Disc: 1, Year: 1977, Duration: 146, Mtime: 1700000002000,
		FilePath: c.FileLow1, BitRate: 256000, Genre: "Rock",
	})
	a.seedSong(t, songSeed{
		ID: c.SZiggy1, Title: "Five Years", AlbumID: c.AlZiggy, ArtistID: c.ArBowie,
		LibraryID: c.LibB, Track: 1, Disc: 1, Year: 1972, Duration: 287, Mtime: 1700000003000,
		FilePath: fileDir + "/bowie/ziggy/01-FiveYears.flac", BitRate: 900000, Genre: "Rock",
	})

	a.junction(t, "song_genres", "song_id", "genre_id", c.SAbbey1, c.GRock, 0)
	a.junction(t, "song_genres", "song_id", "genre_id", c.SAbbey2, c.GRock, 0)
	a.junction(t, "song_genres", "song_id", "genre_id", c.SLow1, c.GRock, 0)
	a.junction(t, "album_genres", "album_id", "genre_id", c.AlAbbey, c.GRock, 0)
	a.junction(t, "album_genres", "album_id", "genre_id", c.AlLow, c.GRock, 0)
	// Ziggy is the multi-genre album: Rock primary, Pop secondary.
	a.junction(t, "album_genres", "album_id", "genre_id", c.AlZiggy, c.GRock, 0)
	a.junction(t, "album_genres", "album_id", "genre_id", c.AlZiggy, c.GPop, 1)

	a.seedCoverArt(t, c.CoverAbbey, "image/jpeg", []byte("fake-jpeg-bytes"))
	a.exec(t, `UPDATE albums SET cover_art_id = ? WHERE id = ?`, c.CoverAbbey, c.AlAbbey)
	return c
}

type songSeed struct {
	ID, Title     string
	AlbumID       string
	ArtistID      string
	LibraryID     string
	Track, Disc   int
	Year          int
	Duration      int
	Mtime         int64
	FilePath      string
	BitRate       int
	Genre         string
	MediaType     string
	Active        int
	Lyrics        string
	ReplayGain    float64
	ProducersJSON string
	ISRCsJSON     string
	SortName      string
	Comment       string
	MusicBrainzID string
	CoverArtID    string
}

func (a *testApp) seedSong(t *testing.T, s songSeed) {
	t.Helper()
	active := s.Active
	if active == 0 {
		active = 1
	}
	_, err := a.db.Exec(`INSERT INTO songs (
		id, title, album_id, artist_id, library_id, track_number, disc_number, year,
		duration, mtime, file_path, bit_rate, genre, media_type, active, checksum,
		lyrics, replay_gain, producers, isrcs, sort_name, comment, music_brainz_id, cover_art_id
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sum', ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.ID, s.Title, nullable(s.AlbumID), nullable(s.ArtistID), nullable(s.LibraryID),
		s.Track, s.Disc, s.Year, s.Duration, s.Mtime, s.FilePath, s.BitRate,
		nullable(s.Genre), nullable(s.MediaType), active,
		nullable(s.Lyrics), nullFloat64(s.ReplayGain), nullable(s.ProducersJSON),
		nullable(s.ISRCsJSON), nullable(s.SortName), nullable(s.Comment),
		nullable(s.MusicBrainzID), nullable(s.CoverArtID))
	if err != nil {
		t.Fatalf("seed song %s: %v", s.ID, err)
	}
}

func (a *testApp) seedArtist(t *testing.T, id, name string) {
	t.Helper()
	a.exec(t, `INSERT INTO artists (id, name) VALUES (?, ?)`, id, name)
}

func (a *testApp) seedAlbum(t *testing.T, id, name, artistID string, year int) {
	t.Helper()
	a.exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, year)
		VALUES (?, ?, ?, (SELECT name FROM artists WHERE id = ?), ?)`, id, name, artistID, artistID, year)
}

func (a *testApp) seedGenre(t *testing.T, id, name string) {
	t.Helper()
	a.exec(t, `INSERT INTO genres (id, name) VALUES (?, ?)`, id, name)
}

func (a *testApp) junction(t *testing.T, table, ownerCol, entryCol, owner, entry string, position int) {
	t.Helper()
	a.exec(t, fmt.Sprintf(`INSERT INTO %s (%s, %s, position) VALUES (?, ?, ?)`, table, ownerCol, entryCol),
		owner, entry, position)
}

func (a *testApp) seedCoverArt(t *testing.T, id, format string, data []byte) {
	t.Helper()
	a.exec(t, `INSERT INTO cover_arts (id, format, data, hash) VALUES (?, ?, ?, ?)`,
		id, format, data, "h-"+id)
}

func (a *testApp) seedUserSong(t *testing.T, userID, songID string, starred int, rating sql.NullFloat64, playCount int) {
	t.Helper()
	a.exec(t, `INSERT INTO user_songs (user_id, song_id, starred, rating, play_count) VALUES (?, ?, ?, ?, ?)`,
		userID, songID, starred, rating, playCount)
}

func (a *testApp) seedUserAlbum(t *testing.T, userID, albumID string, starred int, rating sql.NullFloat64) {
	t.Helper()
	a.exec(t, `INSERT INTO user_albums (user_id, album_id, starred, rating) VALUES (?, ?, ?, ?)`,
		userID, albumID, starred, rating)
}

func (a *testApp) seedUserArtist(t *testing.T, userID, artistID string, starred int) {
	t.Helper()
	a.exec(t, `INSERT INTO user_artists (user_id, artist_id, starred) VALUES (?, ?, ?)`,
		userID, artistID, starred)
}

func (a *testApp) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := a.db.Exec(query, args...); err != nil {
		t.Fatalf("seed exec: %v\nquery: %s", err, query)
	}
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullFloat64(f float64) any {
	if f == 0 {
		return nil
	}
	return f
}
