// Review-folder retention cleanup tests: aged files in any review/ folder
// under the ingest path are deleted, fresh files survive, the settings
// value is clamped to 1–365 like the retired server, and a successful run anchors the
// scheduler's last_review_cleanup timestamp.
package ingest_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func ageFile(t *testing.T, path string, age time.Duration) {
	t.Helper()
	past := time.Now().Add(-age)
	if err := os.Chtimes(path, past, past); err != nil {
		t.Fatalf("chtimes %s: %v", path, err)
	}
}

func TestRunReviewCleanupAgesFilesOut(t *testing.T) {
	e := newEnv(t, true)
	now := time.Now()

	dropReview := filepath.Join(e.ingest, e.libraryID, "review")
	if err := os.MkdirAll(dropReview, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	aged := filepath.Join(dropReview, "old-1.mp3")
	fresh := filepath.Join(dropReview, "fresh.mp3")
	writeFile(t, aged, "old")
	writeFile(t, fresh, "fresh")
	ageFile(t, aged, 40*24*time.Hour)

	// A nested library's review folder sweeps too.
	nestedReview := filepath.Join(e.ingest, "another-lib", "review")
	if err := os.MkdirAll(nestedReview, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	nestedAged := filepath.Join(nestedReview, "old-2.mp3")
	writeFile(t, nestedAged, "old")
	ageFile(t, nestedAged, 40*24*time.Hour)

	// Not a review folder: files here must survive.
	elsewhere := filepath.Join(e.ingest, "another-lib", "keep.mp3")
	writeFile(t, elsewhere, "keep")
	ageFile(t, elsewhere, 90*24*time.Hour)

	stats, err := e.svc.RunReviewCleanup(context.Background(), now)
	if err != nil {
		t.Fatalf("RunReviewCleanup: %v", err)
	}
	if stats.Deleted != 2 || stats.Failed != 0 {
		t.Errorf("stats = %+v, want deleted=2", *stats)
	}
	if fileExists(aged) || fileExists(nestedAged) {
		t.Error("aged review files survived")
	}
	if !fileExists(fresh) {
		t.Error("fresh review file was deleted")
	}
	if !fileExists(elsewhere) {
		t.Error("non-review file was deleted")
	}

	// The scheduler's anchor is written (old: handler marks the last run).
	var last string
	if err := e.db.QueryRow(`SELECT value FROM settings WHERE key = 'last_review_cleanup'`).Scan(&last); err != nil {
		t.Errorf("last_review_cleanup not written: %v", err)
	}
}

func TestRunReviewCleanupRetentionClamp(t *testing.T) {
	e := newEnv(t, true)
	now := time.Now()

	reviewDir := filepath.Join(e.ingest, e.libraryID, "review")
	if err := os.MkdirAll(reviewDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	tenDays := filepath.Join(reviewDir, "ten.mp3")
	writeFile(t, tenDays, "ten")
	ageFile(t, tenDays, 10*24*time.Hour)

	// Out-of-range settings values fall back to the default (30): the
	// 10-day-old file survives, nothing is deleted.
	for _, bad := range []string{"999", "0", "not-a-number"} {
		if _, err := e.db.Exec(
			`INSERT INTO settings (key, value) VALUES ('review_retention_days', ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, bad); err != nil {
			t.Fatalf("set retention: %v", err)
		}
		stats, err := e.svc.RunReviewCleanup(context.Background(), now)
		if err != nil {
			t.Fatalf("RunReviewCleanup(%q): %v", bad, err)
		}
		if stats.Deleted != 0 {
			t.Errorf("retention %q: deleted %d, want 0 (default 30d keeps the file)", bad, stats.Deleted)
		}
		if !fileExists(tenDays) {
			t.Fatalf("retention %q: 10-day-old file deleted", bad)
		}
	}

	// In-range setting wins: 5 days deletes the 10-day-old file.
	if _, err := e.db.Exec(`UPDATE settings SET value = '5' WHERE key = 'review_retention_days'`); err != nil {
		t.Fatalf("set retention: %v", err)
	}
	stats, err := e.svc.RunReviewCleanup(context.Background(), now)
	if err != nil {
		t.Fatalf("RunReviewCleanup: %v", err)
	}
	if stats.Deleted != 1 {
		t.Errorf("retention 5: deleted %d, want 1", stats.Deleted)
	}
}
