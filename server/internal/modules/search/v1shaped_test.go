package search_test

// Regression test for the P10b gap on v1-migrated databases: catalog rows
// written by v1 (fractional REAL mtimes/durations, a TEXT mtime, NULL
// genres, an album with NULL artist_name), persisted without any FTS
// maintenance, converged by the 0004 backfill migration. Every /api/search
// category must return them — on the production snapshot this exact shape
// made the songs category fail to scan (REAL mtime into a plain int64) and
// the API answered empty until each song was re-persisted.

import (
	"context"
	"net/http"
	"os"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/db"
)

// v1ShapedServer builds a migrated database whose catalog rows are raw
// v1-shaped inserts (no FTS maintenance), then converges the indexes with
// the real 0004 migration file — the state a v1-migrated database ends in.
func v1ShapedServer(t *testing.T) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	s := newServer(t, database)

	// The rows predate the indexes: wipe what the empty-table backfills
	// produced and insert the catalog exactly the way v1 left it.
	s.mustExec(t, `DELETE FROM songs_fts; DELETE FROM albums_fts; DELETE FROM artists_fts`)
	s.mustExec(t, `INSERT INTO users (id, username, password_hash, is_admin) VALUES ('user-admin', 'root', 'x', 1)`)
	s.mustExec(t, `INSERT INTO artists (id, name, active) VALUES ('ar-1', 'Alpha', 1)`)
	s.mustExec(t, `INSERT INTO albums (id, name, artist_id, artist_name, active, genre) VALUES
		('al-1', 'Blueprints', 'ar-1', NULL, 1, NULL),
		('al-2', 'Greenprints', 'ar-1', 'Alpha', 1, 'Jazz')`)
	s.mustExec(t, `INSERT INTO songs (id, file_path, title, artist_id, album_id, genre, mtime, checksum, active, duration) VALUES
		('s-1', '/m/1.flac', 'Blue Shadows', 'ar-1', 'al-1', NULL, 1785303721784.2559, 'k1', 1, 200.4),
		('s-2', '/m/2.flac', 'Green Lights', 'ar-1', 'al-2', 'Jazz', '1785303722784', 'k2', 1, 210.75),
		('s-3', '/m/3.flac', 'Blue Ghost', 'ar-1', 'al-1', NULL, 1785303723784, 'k3', 0, 199)`)

	// Converge through the real migration body, the way the runner applies it.
	body, err := os.ReadFile("../../db/migrations/0004_search_fts_backfill_fix.sql")
	if err != nil {
		t.Fatalf("read 0004 migration: %v", err)
	}
	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(context.Background(), string(body)); err != nil {
		tx.Rollback()
		t.Fatalf("apply 0004 backfill: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSearchV1ShapedLibrary(t *testing.T) {
	s := v1ShapedServer(t)
	admin := s.session(t, "user-admin", "root", true)

	// Song by title prefix: the fractional-REAL-mtime row must scan (this is
	// the regression — it used to fail the whole songs category) and its
	// mtime must arrive truncated to whole milliseconds.
	rec := s.do(t, http.MethodGet, "/api/search?q=blue%20shad&type=songs", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("song search: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	results := decodeResults(t, rec)
	if len(results.Songs) != 1 || results.Songs[0].ID != "s-1" {
		t.Fatalf("song search must return s-1, got %v", songIDs(results))
	}
	if got, want := results.Songs[0].Mtime, int64(1785303721784); got != want {
		t.Fatalf("fractional REAL mtime must truncate to %d, got %d", want, got)
	}

	// The TEXT-mtime row scans too.
	rec = s.do(t, http.MethodGet, "/api/search?q=green%20lig&type=songs", admin)
	results = decodeResults(t, rec)
	if !contains(songIDs(results), "s-2") {
		t.Fatalf("text-mtime song must be searchable, got %v", songIDs(results))
	}

	// Album by name, including the one with NULL artist_name.
	rec = s.do(t, http.MethodGet, "/api/search?q=blueprints&type=albums", admin)
	results = decodeResults(t, rec)
	found := false
	for _, a := range results.Albums {
		if a.ID == "al-1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("album with NULL artist_name must be searchable: %+v", results.Albums)
	}

	// Artist by name.
	rec = s.do(t, http.MethodGet, "/api/search?q=alph&type=artists", admin)
	results = decodeResults(t, rec)
	if len(results.Artists) != 1 || results.Artists[0].ID != "ar-1" {
		t.Fatalf("artist search: %+v", results.Artists)
	}

	// The inactive song stays out of every category.
	rec = s.do(t, http.MethodGet, "/api/search?q=ghost&type=songs", admin)
	results = decodeResults(t, rec)
	if len(results.Songs) != 0 {
		t.Fatalf("inactive song leaked: %v", songIDs(results))
	}
}
