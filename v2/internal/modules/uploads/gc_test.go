// Sweeper tests: stale sessions (aged rows) and their chunk dirs go away,
// fresh sessions survive, and directories whose row is gone are reclaimed
// as orphans.

package uploads_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/uploads"
)

// seedSession creates a session row plus its chunk dir with one chunk file.
func seedSession(t *testing.T, s *uploadServer, repo *uploads.Repository, libraryID string) (id string, dir string) {
	t.Helper()
	session, err := repo.Create(context.Background(), libraryID, "")
	if err != nil {
		t.Fatalf("seed session: %v", err)
	}
	dir = filepath.Join(s.dataDir, "uploads", session.ID)
	if err := os.MkdirAll(filepath.Join(dir, "chunks", "f1"), 0o755); err != nil {
		t.Fatalf("seed chunk dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "chunks", "f1", "0"), []byte("chunk"), 0o644); err != nil {
		t.Fatalf("seed chunk: %v", err)
	}
	return session.ID, dir
}

func TestSweepRemovesStaleOnly(t *testing.T) {
	s := newUploadServer(t)
	libraryID := addLibrary(t, s.db)
	repo := uploads.NewRepository(s.db)

	stale1, stale1Dir := seedSession(t, s, repo, libraryID)
	stale2, stale2Dir := seedSession(t, s, repo, libraryID)
	fresh, freshDir := seedSession(t, s, repo, libraryID)

	// Age two sessions past the retention window by rewriting created_at.
	stamp := time.Now().Add(-48 * time.Hour).UTC().Format(time.RFC3339)
	for _, id := range []string{stale1, stale2} {
		if _, err := s.db.Exec(`UPDATE upload_sessions SET created_at = ? WHERE id = ?`, stamp, id); err != nil {
			t.Fatalf("age session: %v", err)
		}
	}

	// Orphan: a directory whose row disappeared (crash window between the
	// row delete and the dir remove at session complete).
	orphanDir := filepath.Join(s.dataDir, "uploads", uuid.NewString())
	if err := os.MkdirAll(filepath.Join(orphanDir, "chunks"), 0o755); err != nil {
		t.Fatalf("seed orphan: %v", err)
	}

	sessionsRemoved, dirsRemoved, err := uploads.SweepOnce(context.Background(), repo, s.dataDir, time.Now(), uploads.DefaultMaxSessionAge)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if sessionsRemoved != 2 {
		t.Fatalf("want 2 stale sessions removed, got %d", sessionsRemoved)
	}
	// 2 stale dirs + 1 orphan; the fresh dir stays.
	if dirsRemoved != 3 {
		t.Fatalf("want 3 dirs removed, got %d", dirsRemoved)
	}

	for _, dir := range []string{stale1Dir, stale2Dir, orphanDir} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("dir must be swept: %s (%v)", dir, err)
		}
	}
	if _, err := os.Stat(freshDir); err != nil {
		t.Fatalf("fresh dir must survive: %v", err)
	}
	if got := countRows(t, s.db, `SELECT COUNT(1) FROM upload_sessions WHERE id = ?`, fresh); got != 1 {
		t.Fatalf("fresh session row must survive")
	}
	if got := countRows(t, s.db, `SELECT COUNT(1) FROM upload_sessions WHERE id IN (?, ?)`, stale1, stale2); got != 0 {
		t.Fatalf("stale session rows must be deleted")
	}
}

func TestSweepKeepsEverythingInsideRetention(t *testing.T) {
	s := newUploadServer(t)
	libraryID := addLibrary(t, s.db)
	repo := uploads.NewRepository(s.db)
	id, dir := seedSession(t, s, repo, libraryID)

	sessionsRemoved, dirsRemoved, err := uploads.SweepOnce(context.Background(), repo, s.dataDir, time.Now(), uploads.DefaultMaxSessionAge)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if sessionsRemoved != 0 || dirsRemoved != 0 {
		t.Fatalf("young session swept: rows=%d dirs=%d", sessionsRemoved, dirsRemoved)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("young session dir gone: %v", err)
	}
	if got := countRows(t, s.db, `SELECT COUNT(1) FROM upload_sessions WHERE id = ?`, id); got != 1 {
		t.Fatalf("young session row gone")
	}
}
