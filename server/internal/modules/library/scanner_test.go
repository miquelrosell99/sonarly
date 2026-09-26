package library_test

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

func newScanner(t *testing.T, database *sql.DB) *library.Scanner {
	t.Helper()
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	return library.NewScanner(database, log, "")
}

// The end-to-end import: four formats, one shared album, multi-value artists
// and genres, composers, labels, embedded cover art (identical bytes across
// the corpus → one deduped blob), dotfiles and non-audio files skipped.
func TestScanImportsLibrary(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")

	flac := corpusCopy(t, dir, "spike.flac", "01-spike.flac")
	corpusCopy(t, dir, "spike.mp3", "02-spike.mp3")
	corpusCopy(t, dir, "spike.ogg", "03-spike.ogg")
	corpusCopy(t, dir, "spike.m4a", "04-spike.m4a")
	// Skipped entries: a dotfile, a dot-directory, a non-audio file, and a
	// non-audio extension.
	if err := os.WriteFile(filepath.Join(dir, ".sonarly-tmp-123.mp3"), []byte("junk"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".hidden"), 0o755); err != nil {
		t.Fatal(err)
	}
	corpusCopy(t, dir, "spike.flac", filepath.Join(".hidden", "nested.flac"))
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("not audio"), 0o644); err != nil {
		t.Fatal(err)
	}

	scanner := newScanner(t, database)
	stats, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if stats.Scanned != 4 || stats.Added != 4 || stats.Updated != 0 || stats.Moved != 0 || stats.Removed != 0 || stats.Failed != 0 {
		t.Fatalf("stats: %+v", stats)
	}

	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE active = 1`); got != 4 {
		t.Fatalf("songs: want 4 active, got %d", got)
	}
	// Shared tags across the corpus: one album, five artists (two song
	// artists, one album artist, two composers), two genres, one label.
	if got := countRows(t, database, `SELECT COUNT(1) FROM albums`); got != 1 {
		t.Fatalf("albums: want 1, got %d", got)
	}
	var albumName, albumCover string
	if err := database.QueryRow(`SELECT name, cover_art_id FROM albums`).Scan(&albumName, &albumCover); err != nil {
		t.Fatalf("album row: %v", err)
	}
	if albumName != "Spike Album" {
		t.Fatalf("album name: %q", albumName)
	}
	if albumCover == "" {
		t.Fatalf("album must be seeded with cover art from the first song")
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM artists`); got != 5 {
		t.Fatalf("artists: want 5, got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM genres`); got != 2 {
		t.Fatalf("genres: want 2, got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM labels`); got != 1 {
		t.Fatalf("labels: want 1, got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM song_artists`); got != 8 {
		t.Fatalf("song_artists: want 8 (4 songs × 2), got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM song_genres`); got != 8 {
		t.Fatalf("song_genres: want 8, got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM song_composers`); got != 8 {
		t.Fatalf("song_composers: want 8, got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM album_artists`); got != 1 {
		t.Fatalf("album_artists: want 1 (one album, one album artist), got %d", got)
	}
	// All four corpus files embed the same 70-byte PNG: hash dedup must
	// store exactly one blob, and every song must link to it (via the album
	// cover for all four).
	if got := countRows(t, database, `SELECT COUNT(1) FROM cover_arts`); got != 1 {
		t.Fatalf("cover_arts: want 1 deduped blob, got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE cover_art_id = ?`, albumCover); got != 4 {
		t.Fatalf("songs linked to album cover: want 4, got %d", got)
	}

	// Scalar tag mapping on the FLAC (richest format properties).
	var title, albumArtist, mediaType string
	var track, year, sampleRate, channels int
	var duration float64
	err = database.QueryRow(`
		SELECT title, track_number, year, sample_rate, channels, duration, display_album_artist, media_type
		FROM songs WHERE file_path = ?`, flac).Scan(&title, &track, &year, &sampleRate, &channels, &duration, &albumArtist, &mediaType)
	if err != nil {
		t.Fatalf("song row: %v", err)
	}
	if title != "Spike Song (feat. Test)" || track != 3 || year != 2021 || albumArtist != "Spike Album Artist" {
		t.Fatalf("tags: %q %d %d %q", title, track, year, albumArtist)
	}
	if sampleRate != 44100 || channels != 2 || duration != 3 {
		t.Fatalf("properties: sr=%d ch=%d dur=%v", sampleRate, channels, duration)
	}
	if mediaType != "audio/x-flac" {
		t.Fatalf("media_type: %q", mediaType)
	}

	// Library resolution: every song is attributed to the library whose
	// root it lives under.
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE library_id = 'lib-main'`); got != 4 {
		t.Fatalf("library attribution: want 4, got %d", got)
	}

	// Idempotency: a rescan with no changes imports nothing (the mtime fast
	// path), and the cover links are stable (no needsCoverSync churn).
	stats, err = scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if stats.Scanned != 4 || stats.Added != 0 || stats.Updated != 0 || stats.Removed != 0 || stats.Moved != 0 || stats.Failed != 0 {
		t.Fatalf("rescan must be a no-op: %+v", stats)
	}
}

// The v1 B4 fix: average_rating is never in the scanner's upsert columns, so
// a rescan (triggered here by an mtime change) must not touch a rating set
// by users.
func TestRescanPreservesAverageRating(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")
	flac := corpusCopy(t, dir, "spike.flac", "song.flac")

	scanner := newScanner(t, database)
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if _, err := database.Exec(`UPDATE songs SET average_rating = 4.5`); err != nil {
		t.Fatalf("set rating: %v", err)
	}

	bumpMtime(t, flac)
	stats, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if stats.Updated != 1 {
		t.Fatalf("want 1 updated song, got %+v", stats)
	}
	var rating float64
	if err := database.QueryRow(`SELECT average_rating FROM songs`).Scan(&rating); err != nil {
		t.Fatalf("read rating: %v", err)
	}
	if rating != 4.5 {
		t.Fatalf("average_rating clobbered by rescan: got %v", rating)
	}
}

// Changed content at the same path (tags edited, file rewritten) re-imports
// in place: the row is updated, not duplicated.
func TestRescanUpdatesEditedTags(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")
	path := corpusCopy(t, dir, "spike.mp3", "song.mp3")

	scanner := newScanner(t, database)
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("scan: %v", err)
	}
	var beforeID, beforeChecksum string
	if err := database.QueryRow(`SELECT id, checksum FROM songs`).Scan(&beforeID, &beforeChecksum); err != nil {
		t.Fatalf("song row: %v", err)
	}

	// Overwrite with different tags entirely (pathological id3v1: different
	// title/album/artist/year, no cover art).
	data, err := os.ReadFile(filepath.Join(corpusDir, "pathological-id3v1.mp3"))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("rewrite file: %v", err)
	}
	bumpMtime(t, path)

	stats, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if stats.Updated != 1 || stats.Added != 0 || stats.Moved != 0 {
		t.Fatalf("stats: %+v", stats)
	}
	var title, checksum string
	var year int
	var missing int
	if err := database.QueryRow(`SELECT title, year, checksum, cover_art_missing FROM songs WHERE id = ?`, beforeID).
		Scan(&title, &year, &checksum, &missing); err != nil {
		t.Fatalf("song row: %v", err)
	}
	if title != "Café naïve" || year != 1999 {
		t.Fatalf("tags not updated: %q %d", title, year)
	}
	if checksum == beforeChecksum {
		t.Fatalf("checksum must change with content")
	}
	if missing != 1 {
		t.Fatalf("edited file has no embedded art; cover_art_missing=1, got %d", missing)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs`); got != 1 {
		t.Fatalf("want 1 song row, got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM albums WHERE name = 'Séance'`); got != 1 {
		t.Fatalf("edited album must exist")
	}
}

// Move detection: same content at a new path updates the row's path instead
// of importing a duplicate (checksum match).
func TestScanDetectsMovedFile(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")
	oldPath := corpusCopy(t, dir, "spike.flac", "flat.flac")

	scanner := newScanner(t, database)
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("scan: %v", err)
	}
	var songID string
	if err := database.QueryRow(`SELECT id FROM songs`).Scan(&songID); err != nil {
		t.Fatalf("song row: %v", err)
	}

	sub := filepath.Join(dir, "moved")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	newPath := filepath.Join(sub, "renamed.flac")
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatalf("move: %v", err)
	}

	stats, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if stats.Moved != 1 || stats.Added != 0 || stats.Removed != 0 {
		t.Fatalf("stats: %+v", stats)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs`); got != 1 {
		t.Fatalf("move must not duplicate: %d songs", got)
	}
	var gotPath, gotID string
	if err := database.QueryRow(`SELECT file_path, id FROM songs`).Scan(&gotPath, &gotID); err != nil {
		t.Fatalf("song row: %v", err)
	}
	if gotPath != newPath {
		t.Fatalf("path not updated: %q", gotPath)
	}
	if gotID != songID {
		t.Fatalf("move must keep the row (and its user data): %q → %q", songID, gotID)
	}
}

// Deactivation, not deletion: a vanished file marks active=0 and keeps the
// row; re-adding the file reactivates it.
func TestScanDeactivatesAndReactivates(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")
	keep := corpusCopy(t, dir, "spike.flac", "keep.flac")
	gone := corpusCopy(t, dir, "spike.mp3", "gone.mp3")

	scanner := newScanner(t, database)
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("scan: %v", err)
	}

	if err := os.Remove(gone); err != nil {
		t.Fatal(err)
	}
	stats, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if stats.Removed != 1 {
		t.Fatalf("stats: %+v", stats)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs`); got != 2 {
		t.Fatalf("deletion is forbidden; rows must be retained: %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE active = 1`); got != 1 {
		t.Fatalf("active songs: want 1, got %d", got)
	}
	// The remaining file was not touched.
	var keepActive int
	if err := database.QueryRow(`SELECT active FROM songs WHERE file_path = ?`, keep).Scan(&keepActive); err != nil {
		t.Fatalf("row: %v", err)
	}
	if keepActive != 1 {
		t.Fatalf("untouched file deactivated")
	}

	// Re-add the file: the row reactivates instead of a duplicate import.
	corpusCopy(t, dir, "spike.mp3", "gone.mp3")
	stats, err = scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if stats.Updated != 1 || stats.Added != 0 || stats.Removed != 0 {
		t.Fatalf("reactivation stats: %+v", stats)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE active = 1`); got != 2 {
		t.Fatalf("reactivated songs: want 2, got %d", got)
	}
}

// The unmounted-drive guard: when the library root cannot be read, the scan
// skips it and the deactivation pass leaves its rows alone.
func TestScanUnreadableRootDoesNotMassDeactivate(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")
	corpusCopy(t, dir, "spike.flac", "song.flac")

	scanner := newScanner(t, database)
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("scan: %v", err)
	}

	// Point the library at a path that does not exist (unmounted drive).
	if _, err := database.Exec(`UPDATE libraries SET path = ? WHERE id = 'lib-main'`, filepath.Join(dir, "missing-mount")); err != nil {
		t.Fatalf("repoint library: %v", err)
	}
	stats, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("scan over unreadable root: %v", err)
	}
	if stats.Removed != 0 {
		t.Fatalf("unmounted root must not deactivate: %+v", stats)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE active = 1`); got != 1 {
		t.Fatalf("songs must stay active: %d", got)
	}

	// And a library-scoped payload against the unreadable root behaves the
	// same while other libraries are untouched.
	stats, err = scanner.Scan(context.Background(), library.ScanPayload{LibraryID: "lib-main"}, nil)
	if err != nil {
		t.Fatalf("scoped scan: %v", err)
	}
	if stats.Removed != 0 || stats.Scanned != 0 {
		t.Fatalf("scoped scan over unreadable root: %+v", stats)
	}
}

// A scan scoped to one library imports only that library's files and never
// deactivates rows outside the walked root.
func TestScanScopedToLibrary(t *testing.T) {
	database := openDB(t)
	dirA := libraryFixture(t, database, "lib-a")
	dirB := libraryFixture(t, database, "lib-b")
	corpusCopy(t, dirA, "spike.flac", "a.flac")
	corpusCopy(t, dirB, "spike.mp3", "b.mp3")

	scanner := newScanner(t, database)
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("initial scan: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs`); got != 2 {
		t.Fatalf("fixture: want 2 songs, got %d", got)
	}

	// Remove lib-b's file and add one to lib-a, then scan only lib-b: the
	// walked root is lib-b alone, so lib-a rows must not be touched.
	if err := os.Remove(filepath.Join(dirB, "b.mp3")); err != nil {
		t.Fatal(err)
	}
	corpusCopy(t, dirA, "spike.ogg", "a2.ogg")
	stats, err := scanner.Scan(context.Background(), library.ScanPayload{LibraryID: "lib-b"}, nil)
	if err != nil {
		t.Fatalf("scoped rescan: %v", err)
	}
	if stats.Scanned != 0 || stats.Removed != 1 {
		t.Fatalf("scoped deactivation: %+v", stats)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE library_id = 'lib-a' AND active = 1`); got != 1 {
		t.Fatalf("other library's rows must not be touched: %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE library_id = 'lib-b' AND active = 1`); got != 0 {
		t.Fatalf("lib-b rows must be deactivated: %d", got)
	}
}

// Replaced-file detection: an inactive row with matching title/album/artist
// is reused for a new file, preserving user data (the same mechanism that
// keeps ratings attached across a re-rip). Like v1, the lookup matches
// inactive rows, so the reuse happens once the deletion has been scanned —
// the usual re-rip sequence spans two rescans.
func TestScanReusesInactiveRowForReplacedFile(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")
	original := corpusCopy(t, dir, "spike.flac", "original.flac")

	scanner := newScanner(t, database)
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("scan: %v", err)
	}
	var songID string
	if err := database.QueryRow(`SELECT id FROM songs`).Scan(&songID); err != nil {
		t.Fatalf("row: %v", err)
	}
	if _, err := database.Exec(`UPDATE songs SET average_rating = 5 WHERE id = ?`, songID); err != nil {
		t.Fatalf("rate: %v", err)
	}

	// Scan 1: the original disappears → row deactivated (not deleted).
	if err := os.Remove(original); err != nil {
		t.Fatal(err)
	}
	stats, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("rescan after delete: %v", err)
	}
	if stats.Removed != 1 {
		t.Fatalf("deletion stats: %+v", stats)
	}

	// Scan 2: a DIFFERENT file (different checksum) with the same
	// title/album/artist arrives — the inactive row is reused.
	corpusCopy(t, dir, "spike.mp3", "ripped.mp3")
	stats, err = scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("rescan after re-rip: %v", err)
	}
	if stats.Added != 0 || stats.Moved != 1 {
		t.Fatalf("replaced file must reuse the row, not add: %+v", stats)
	}
	var gotID string
	var rating float64
	if err := database.QueryRow(`SELECT id, average_rating FROM songs WHERE active = 1`).Scan(&gotID, &rating); err != nil {
		t.Fatalf("row: %v", err)
	}
	if gotID != songID {
		t.Fatalf("inactive row not reused: %q vs %q", gotID, songID)
	}
	if rating != 5 {
		t.Fatalf("user rating lost across replace: %v", rating)
	}
}
