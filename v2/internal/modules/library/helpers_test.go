package library_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/db"
)

// openDB returns a migrated in-memory database.
func openDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// addLibrary registers a libraries row pointing at path.
func addLibrary(t *testing.T, database *sql.DB, id, path string) {
	t.Helper()
	if _, err := database.Exec(
		`INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		id, id, path); err != nil {
		t.Fatalf("insert library: %v", err)
	}
}

// libraryFixture creates a temp library dir and its libraries row.
func libraryFixture(t *testing.T, database *sql.DB, id string) string {
	t.Helper()
	dir := t.TempDir()
	addLibrary(t, database, id, dir)
	return dir
}

const corpusDir = "../../audio/testdata/corpus"

// corpusCopy copies a corpus audio file into dir under dst and returns the
// new path.
func corpusCopy(t *testing.T, dir, src, dst string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(corpusDir, src))
	if err != nil {
		t.Fatalf("read corpus file %s: %v", src, err)
	}
	path := filepath.Join(dir, dst)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

// corpusCopies copies the same corpus file n times with numbered names.
func corpusCopies(t *testing.T, dir, src, base string, n int) []string {
	t.Helper()
	var paths []string
	for i := 0; i < n; i++ {
		paths = append(paths, corpusCopy(t, dir, src, fmt.Sprintf("%s-%03d%s", base, i, filepath.Ext(src))))
	}
	return paths
}

// bumpMtime moves path's mtime two hours into the future so the scanner's
// mtime fast path no longer applies.
func bumpMtime(t *testing.T, path string) {
	t.Helper()
	future := time.Now().Add(2 * time.Hour)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatalf("chtimes %s: %v", path, err)
	}
}

func countRows(t *testing.T, database *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := database.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count rows: %v\n%s", err, query)
	}
	return n
}

// waitFor polls cond until it holds or the timeout elapses.
func waitFor(t *testing.T, timeout time.Duration, msg string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", msg)
}
