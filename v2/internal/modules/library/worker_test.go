package library_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
)

func newWorker(t *testing.T, database *sql.DB) (*library.Queue, *library.Worker) {
	t.Helper()
	queue := library.NewQueue(database)
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	scanner := library.NewScanner(database, log, "")
	return queue, library.NewWorker(queue, scanner, log)
}

func TestWorkerCompletesScanJob(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")
	corpusCopy(t, dir, "spike.flac", "a.flac")
	corpusCopy(t, dir, "spike.mp3", "b.mp3")

	queue, worker := newWorker(t, database)
	if _, err := queue.Push(context.Background(), library.JobTypeScan, library.ScanPayload{}); err != nil {
		t.Fatalf("push: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { worker.Start(ctx); close(done) }()

	select {
	case ev := <-worker.Events():
		if ev.Error != "" {
			t.Fatalf("job event error: %s", ev.Error)
		}
		if ev.Type != library.JobTypeScan {
			t.Fatalf("event type: %q", ev.Type)
		}
		var stats library.ScanStats
		if err := json.Unmarshal(ev.Stats, &stats); err != nil {
			t.Fatalf("event stats: %v", err)
		}
		if stats.Added != 2 || stats.Failed != 0 {
			t.Fatalf("stats: %+v", stats)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for job event")
	}

	job, err := queue.Latest(context.Background())
	if err != nil || job == nil {
		t.Fatalf("latest: %v %+v", err, job)
	}
	if job.Status != library.StatusCompleted || job.StartedAt == "" || job.FinishedAt == "" {
		t.Fatalf("job state: %+v", job)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs WHERE active = 1`); got != 2 {
		t.Fatalf("songs: want 2, got %d", got)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop after context cancellation")
	}
}

// Placeholder job types (P6/P7) must fail gracefully, not crash the loop or
// retry forever.
func TestWorkerPlaceholderJobFailsGracefully(t *testing.T) {
	database := openDB(t)

	queue, worker := newWorker(t, database)
	id, err := queue.Push(context.Background(), library.JobTypeArtistImages, library.ArtistImagesPayload{RefetchExisting: true})
	if err != nil {
		t.Fatalf("push: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { worker.Start(ctx); close(done) }()

	select {
	case ev := <-worker.Events():
		if !strings.Contains(ev.Error, "not implemented") {
			t.Fatalf("want graceful not-implemented error, got %q", ev.Error)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for job event")
	}
	job, err := queue.JobByID(context.Background(), id)
	if err != nil || job == nil {
		t.Fatalf("job: %v %+v", err, job)
	}
	if job.Status != library.StatusFailed || !strings.Contains(job.Error, "not implemented") {
		t.Fatalf("placeholder job must be marked failed: %+v", job)
	}

	// The loop keeps serving jobs after a placeholder failure.
	id2, err := queue.Push(context.Background(), library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	select {
	case ev := <-worker.Events():
		if ev.JobID != id2 || ev.Error != "" {
			t.Fatalf("follow-up job: %+v", ev)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for follow-up job")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop after context cancellation")
	}
}

// Context-driven cancellation: cancelling the server context mid-scan stops
// the walk between songs, rolls back the in-flight per-song tx, and marks
// the job failed — and the database stays consistent (no partial songs).
func TestWorkerCancelsScanJobMidScan(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")
	const files = 300
	corpusCopies(t, dir, "spike.flac", "bulk", files)

	queue, worker := newWorker(t, database)
	id, err := queue.Push(context.Background(), library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatalf("push: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { worker.Start(ctx); close(done) }()

	// Wait until the scan is genuinely in flight (progress stats land).
	waitFor(t, 10*time.Second, "scan progress", func() bool {
		job, err := queue.JobByID(context.Background(), id)
		if err != nil || job == nil || len(job.Stats) == 0 {
			return false
		}
		var stats library.ScanStats
		if err := json.Unmarshal(job.Stats, &stats); err != nil {
			return false
		}
		return stats.Scanned >= 25
	})
	cancel()

	waitFor(t, 10*time.Second, "job marked failed after cancel", func() bool {
		job, err := queue.JobByID(context.Background(), id)
		return err == nil && job != nil && job.Status == library.StatusFailed &&
			strings.Contains(job.Error, "cancelled")
	})
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop after context cancellation")
	}

	// Consistency: a fresh scan over the same library completes — a
	// cancelled per-song tx must not have left a partial song (row without
	// its junctions) behind. Songs committed before the cancellation are
	// mtime-skipped; the rest import cleanly, landing at exactly one row
	// per file on disk.
	scannerLog := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	scanner := library.NewScanner(database, scannerLog, "")
	stats, err := scanner.Scan(context.Background(), library.ScanPayload{}, nil)
	if err != nil {
		t.Fatalf("consistency rescan: %v", err)
	}
	if stats.Scanned != files || stats.Failed != 0 {
		t.Fatalf("consistency stats: %+v", stats)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM songs`); got != files {
		t.Fatalf("songs: want %d total, got %d", files, got)
	}
	// Every corpus song has exactly 2 song-artist and 2 genre junctions;
	// a rolled-back tx could not satisfy this.
	if got := countRows(t, database, `
		SELECT COUNT(1) FROM songs s
		WHERE (SELECT COUNT(1) FROM song_artists sa WHERE sa.song_id = s.id) != 2
		   OR (SELECT COUNT(1) FROM song_genres sg WHERE sg.song_id = s.id) != 2
		   OR s.album_id IS NULL OR s.artist_id IS NULL`); got != 0 {
		t.Fatalf("partial song rows detected: %d", got)
	}
}
