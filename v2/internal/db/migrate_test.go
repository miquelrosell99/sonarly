package db

// Regression tests for the P10b gap: a v1-shaped database (tables pre-date
// the v2 migrations, rows written raw the way v1's better-sqlite3 bindings
// wrote them) must end up fully searchable after Migrate, on both the
// fresh-migration path and the already-migrated-dev-database path, and the
// 0004 backfill must be safe to re-run.

import (
	"context"
	"database/sql"
	"testing"
)

// execMigrationFile applies one embedded migration file in a transaction,
// the same way Migrate does (minus the ledger row — setup files pre-date the
// ledger or are recorded by Migrate itself).
func execMigrationFile(t *testing.T, database *sql.DB, name string) {
	t.Helper()
	ctx := context.Background()
	body, err := migrationsFS.ReadFile("migrations/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, string(body)); err != nil {
		tx.Rollback()
		t.Fatalf("apply %s: %v", name, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit %s: %v", name, err)
	}
}

// seedV1ShapedLibrary inserts catalog rows the way v1's scanner did: raw
// better-sqlite3 bindings of JS values — fractional REAL mtimes/durations, a
// TEXT mtime, NULL genres, an album with a NULL denormalized artist_name —
// with no FTS maintenance whatsoever.
func seedV1ShapedLibrary(t *testing.T, database *sql.DB) {
	t.Helper()
	if _, err := database.Exec(`
		INSERT INTO artists (id, name, active) VALUES ('ar-1', 'Alpha', 1);
		INSERT INTO albums (id, name, artist_id, artist_name, active, genre) VALUES
			('al-1', 'Blueprints', 'ar-1', NULL, 1, NULL),
			('al-2', 'Greenprints', 'ar-1', 'Alpha', 1, 'Jazz');
		INSERT INTO songs (id, file_path, title, artist_id, album_id, genre, mtime, checksum, active, duration) VALUES
			('s-1', '/m/1.flac', 'Blue Shadows', 'ar-1', 'al-1', NULL, 1785303721784.2559, 'k1', 1, 200.4),
			('s-2', '/m/2.flac', 'Green Lights', 'ar-1', 'al-2', 'Jazz', '1785303722784', 'k2', 1, 210.75),
			('s-3', '/m/3.flac', 'Blue Ghost', 'ar-1', 'al-1', NULL, 1785303723784, 'k3', 0, 199);
	`); err != nil {
		t.Fatalf("seed v1-shaped library: %v", err)
	}
}

func ftsSnapshot(t *testing.T, database *sql.DB) map[string]int {
	t.Helper()
	probes := map[string]string{
		"songs_fts":   `SELECT COUNT(1) FROM songs_fts`,
		"albums_fts":  `SELECT COUNT(1) FROM albums_fts`,
		"artists_fts": `SELECT COUNT(1) FROM artists_fts`,
		"songs:blue":  `SELECT COUNT(1) FROM songs_fts WHERE songs_fts MATCH '"blue"'`,
		"songs:green": `SELECT COUNT(1) FROM songs_fts WHERE songs_fts MATCH '"green"'`,
		"albums:blue": `SELECT COUNT(1) FROM albums_fts WHERE albums_fts MATCH '"blueprints"'`,
		"artists:alp": `SELECT COUNT(1) FROM artists_fts WHERE artists_fts MATCH '"alpha"'`,
	}
	out := map[string]int{}
	for key, q := range probes {
		var n int
		if err := database.QueryRow(q).Scan(&n); err != nil {
			t.Fatalf("probe %s: %v", key, err)
		}
		out[key] = n
	}
	return out
}

func openV1ShapedDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	// v1 tables exist, built by v1's own migration chain; the ledger records
	// 0001+0002 as a migrated v1 database would.
	execMigrationFile(t, database, "0001_baseline.sql")
	execMigrationFile(t, database, "0002_job_payload.sql")
	recordApplied(t, database, "0001_baseline.sql", "0002_job_payload.sql")
	seedV1ShapedLibrary(t, database)
	return database
}

// recordApplied pre-seeds the migration ledger the way a previous Migrate
// run would have (setup for databases that already carry part of the chain).
func recordApplied(t *testing.T, database *sql.DB, names ...string) {
	t.Helper()
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations
		(filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		if _, err := database.Exec(`INSERT INTO schema_migrations (filename) VALUES (?)`, name); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMigrateBackfillsV1ShapedLibraryFTS(t *testing.T) {
	database := openV1ShapedDB(t)
	if err := Migrate(context.Background(), database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var pending int
	if err := database.QueryRow(
		`SELECT COUNT(1) FROM schema_migrations WHERE filename = '0004_search_fts_backfill_fix.sql'`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("0004 must be recorded in the ledger, got %d", pending)
	}

	// The indexes mirror the ACTIVE corpus: 2 active songs (the inactive
	// Blue Ghost stays out), 2 albums, 1 artist — and MATCH queries hit.
	want := map[string]int{
		"songs_fts": 2, "albums_fts": 2, "artists_fts": 1,
		"songs:blue": 1, "songs:green": 1, "albums:blue": 1, "artists:alp": 1,
	}
	got := ftsSnapshot(t, database)
	for k, w := range want {
		if got[k] != w {
			t.Fatalf("FTS probe %s = %d, want %d (full snapshot %v)", k, got[k], w, got)
		}
	}
	// The inactive song is not indexed even though a same-title prefix
	// would match it.
	var ghost int
	if err := database.QueryRow(
		`SELECT COUNT(1) FROM songs_fts WHERE songs_fts MATCH '"ghost"'`).Scan(&ghost); err != nil {
		t.Fatal(err)
	}
	if ghost != 0 {
		t.Fatalf("inactive song leaked into the index: %d", ghost)
	}
}

func TestFTSBackfillMigrationIsIdempotent(t *testing.T) {
	database := openV1ShapedDB(t)
	if err := Migrate(context.Background(), database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	before := ftsSnapshot(t, database)
	// Re-apply the 0004 body twice more, the way a repair would: identical
	// row counts and MATCH hits every time.
	for i := 0; i < 2; i++ {
		execMigrationFile(t, database, "0004_search_fts_backfill_fix.sql")
		after := ftsSnapshot(t, database)
		for k, w := range before {
			if after[k] != w {
				t.Fatalf("re-run %d changed probe %s from %d to %d", i, k, w, after[k])
			}
		}
	}
}

func TestMigrateFreshAndExistingDBsConverge(t *testing.T) {
	// Fresh path: v1 tables + rows first, then the whole 0001-0004 chain.
	fresh := openV1ShapedDB(t)
	if err := Migrate(context.Background(), fresh); err != nil {
		t.Fatalf("migrate fresh: %v", err)
	}

	// Existing-dev-DB path: 0001-0003 already recorded (old dev database),
	// catalog rows written later through a path that bypassed the FTS sync,
	// then Migrate applies only 0004.
	existing, err := Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { existing.Close() })
	execMigrationFile(t, existing, "0001_baseline.sql")
	execMigrationFile(t, existing, "0002_job_payload.sql")
	execMigrationFile(t, existing, "0003_search_fts.sql") // backfills empty tables
	recordApplied(t, existing, "0001_baseline.sql", "0002_job_payload.sql", "0003_search_fts.sql")
	seedV1ShapedLibrary(t, existing)
	if err := Migrate(context.Background(), existing); err != nil {
		t.Fatalf("migrate existing: %v", err)
	}

	freshSnap, existingSnap := ftsSnapshot(t, fresh), ftsSnapshot(t, existing)
	for k, w := range freshSnap {
		if existingSnap[k] != w {
			t.Fatalf("divergence on %s: fresh=%d existing=%d", k, w, existingSnap[k])
		}
	}
}

func TestBackfillRerunKeepsDeactivatedSongsOut(t *testing.T) {
	database := openV1ShapedDB(t)
	if err := Migrate(context.Background(), database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Deactivation as the scanner contracts it: row goes inactive AND the
	// index row is deleted. A 0004 re-run must not resurrect it.
	if _, err := database.Exec(`
		UPDATE songs SET active = 0 WHERE id = 's-1';
		DELETE FROM songs_fts WHERE rowid = (SELECT rowid FROM songs WHERE id = 's-1');
	`); err != nil {
		t.Fatal(err)
	}
	execMigrationFile(t, database, "0004_search_fts_backfill_fix.sql")
	if n := ftsSnapshot(t, database)["songs:blue"]; n != 0 {
		t.Fatalf("reactivated-by-backfill: 'blue' matches %d songs, want 0", n)
	}
	if n := ftsSnapshot(t, database)["songs_fts"]; n != 1 {
		t.Fatalf("songs_fts = %d, want 1 (only the active Green Lights)", n)
	}
}
