package library_test

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/miquelrosell99/sonarly/v2/internal/audio"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
)

// meta builds the minimal metadata a persist needs.
func meta(title, artist, album string) *audio.Metadata {
	return &audio.Metadata{
		Title:   title,
		Artist:  artist,
		Artists: []string{artist},
		Album:   album,
	}
}

// ftsMatchCount probes an FTS index through a MATCH query, asserting on
// what a search would actually find.
func ftsMatchCount(t *testing.T, database *sql.DB, fts, match string) int {
	t.Helper()
	var n int
	if err := database.QueryRow(
		`SELECT COUNT(1) FROM `+fts+` WHERE `+fts+` MATCH ?`, match).Scan(&n); err != nil {
		t.Fatalf("probe %s with %q: %v", fts, match, err)
	}
	return n
}

func TestPersistSongSyncsFTS(t *testing.T) {
	database := openDB(t)
	ctx := context.Background()
	libraryID := "lib-fts"
	addLibrary(t, database, libraryID, t.TempDir())

	persist := func(existing *string, title, artist, album string) string {
		t.Helper()
		id, err := library.PersistSong(ctx, database, library.PersistInput{
			ExistingID: existing,
			Path:       "/music/fts/" + title + ".flac",
			Meta:       meta(title, artist, album),
			Mtime:      1,
			Checksum:   "k-" + title,
			LibraryID:  &libraryID,
		})
		if err != nil {
			t.Fatalf("persist %s: %v", title, err)
		}
		return id
	}

	// Insert: every persisted row lands in all three indexes.
	id1 := persist(nil, "Blue Shadows", "Alpha", "Blueprints")
	id2 := persist(nil, "Green Lights", "Beta", "Greenprints")
	if n := ftsMatchCount(t, database, "songs_fts", `"blue"`); n != 1 {
		t.Fatalf("songs_fts must match 'blue' once, got %d", n)
	}
	if n := ftsMatchCount(t, database, "albums_fts", `"blueprints"`); n != 1 {
		t.Fatalf("albums_fts must match 'blueprints' once, got %d", n)
	}
	if n := ftsMatchCount(t, database, "artists_fts", `"beta"`); n != 1 {
		t.Fatalf("artists_fts must match 'beta' once, got %d", n)
	}

	// Update (rescan with a new title): the index entry follows the row —
	// the old token disappears, the new one matches, no duplicate.
	persist(&id1, "Blue Horizons", "Alpha", "Blueprints")
	if n := ftsMatchCount(t, database, "songs_fts", `"shadows"`); n != 0 {
		t.Fatalf("stale token 'shadows' must leave the index, got %d", n)
	}
	if n := ftsMatchCount(t, database, "songs_fts", `"horizons"`); n != 1 {
		t.Fatalf("token 'horizons' must match once, got %d", n)
	}
	if n := ftsMatchCount(t, database, "songs_fts", `"blue"`); n != 1 {
		t.Fatalf("prefix token 'blue' must match the renamed row, got %d", n)
	}

	// Album/artist rename by rescan converges too: the album's artist text
	// changes with the new persist.
	persist(&id2, "Green Lights", "Gamma", "Greenprints II")
	if n := ftsMatchCount(t, database, "albums_fts", `"gamma"`); n != 1 {
		t.Fatalf("albums_fts must match the renamed album artist 'gamma', got %d", n)
	}
	if n := ftsMatchCount(t, database, "artists_fts", `"gamma"`); n != 1 {
		t.Fatalf("artists_fts must match the renamed artist 'gamma', got %d", n)
	}
}

func TestPersistSongReactivationRestoresFTS(t *testing.T) {
	database := openDB(t)
	ctx := context.Background()
	libraryID := "lib-fts2"
	addLibrary(t, database, libraryID, t.TempDir())

	id, err := library.PersistSong(ctx, database, library.PersistInput{
		Path: "/music/fts/reactivate.flac", Meta: meta("Gone Song", "Alpha", "A"),
		Mtime: 1, Checksum: "k-r", LibraryID: &libraryID,
	})
	if err != nil {
		t.Fatalf("persist: %v", err)
	}
	// Deactivation as the scanner does it (row goes inactive, index row
	// deleted), then reactivation through PersistSong: the upsert flips
	// active back and the sync re-inserts the index row.
	database.Exec(`UPDATE songs SET active = 0 WHERE id = ?`, id)
	if _, err := database.Exec(`DELETE FROM songs_fts WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)`, id); err != nil {
		t.Fatalf("manual fts delete: %v", err)
	}
	if n := ftsMatchCount(t, database, "songs_fts", `"gone"`); n != 0 {
		t.Fatalf("deactivated song must leave the index, got %d matches", n)
	}
	if _, err := library.PersistSong(ctx, database, library.PersistInput{
		ExistingID: &id, Path: "/music/fts/reactivate.flac", Meta: meta("Gone Song", "Alpha", "A"),
		Mtime: 2, Checksum: "k-r2", LibraryID: &libraryID,
	}); err != nil {
		t.Fatalf("reactivate persist: %v", err)
	}
	if n := ftsMatchCount(t, database, "songs_fts", `"gone"`); n != 1 {
		t.Fatalf("reactivated song must re-enter the index, got %d", n)
	}
	if n := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE active = 1`); n != 1 {
		t.Fatalf("song must be active again, got %d", n)
	}
}

func TestFTSBackfillIsIdempotent(t *testing.T) {
	database := openDB(t)
	ctx := context.Background()
	libraryID := "lib-fts3"
	addLibrary(t, database, libraryID, t.TempDir())
	for _, title := range []string{"One", "Two", "Three"} {
		if _, err := library.PersistSong(ctx, database, library.PersistInput{
			Path: "/music/fts/" + title + ".flac", Meta: meta(title, "Alpha", "A"),
			Mtime: 1, Checksum: "k-" + title, LibraryID: &libraryID,
		}); err != nil {
			t.Fatalf("persist: %v", err)
		}
	}
	// Drop every index row, then backfill twice: INSERT OR REPLACE keyed by
	// rowid must rebuild exactly and stay stable across re-runs.
	database.Exec(`DELETE FROM songs_fts`)
	backfill := `INSERT OR REPLACE INTO songs_fts (rowid, title) SELECT rowid, title FROM songs WHERE active = 1`
	for i := 0; i < 2; i++ {
		if _, err := database.Exec(backfill); err != nil {
			t.Fatalf("backfill run %d: %v", i, err)
		}
	}
	for _, token := range []string{"one", "two", "three"} {
		if n := ftsMatchCount(t, database, "songs_fts", `"`+token+`"`); n != 1 {
			t.Fatalf("backfill must index %q exactly once, got %d", token, n)
		}
	}

	// The backfill only ADDS missing rows — removals are the writer's job
	// (the scanner deletes on deactivation). With the sync contract applied,
	// an inactive song stays out of the index after a backfill re-run.
	database.Exec(`UPDATE songs SET active = 0 WHERE title = 'Two'`)
	database.Exec(`DELETE FROM songs_fts WHERE rowid = (SELECT rowid FROM songs WHERE title = 'Two')`)
	if _, err := database.Exec(backfill); err != nil {
		t.Fatalf("backfill after deactivation: %v", err)
	}
	if n := ftsMatchCount(t, database, "songs_fts", `"two"`); n != 0 {
		t.Fatalf("inactive song must not re-enter the index, got %d", n)
	}
}

func TestScannerDeactivationRemovesFTS(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-fts-scan")
	path := corpusCopy(t, dir, "spike.flac", "spike.flac")

	scanner := newScanner(t, database)
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if n := ftsMatchCount(t, database, "songs_fts", `"spike"`); n != 1 {
		t.Fatalf("scanned song must be indexed, got %d", n)
	}
	if n := ftsMatchCount(t, database, "albums_fts", `"spike"`); n < 1 {
		t.Fatalf("scanned album must be indexed, got %d", n)
	}

	// The file vanishes: deactivation drops the song from the index in the
	// same pass.
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if n := ftsMatchCount(t, database, "songs_fts", `"spike"`); n != 0 {
		t.Fatalf("deactivated song must leave the index, got %d", n)
	}

	// The file reappears: PersistSong reuse re-activates the row and the
	// sync re-inserts the index entry.
	corpusCopy(t, dir, "spike.flac", "spike.flac")
	if _, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil); err != nil {
		t.Fatalf("rescan 2: %v", err)
	}
	if n := ftsMatchCount(t, database, "songs_fts", `"spike"`); n != 1 {
		t.Fatalf("reactivated song must re-enter the index, got %d", n)
	}
}
