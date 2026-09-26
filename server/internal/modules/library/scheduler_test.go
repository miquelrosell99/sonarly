package library_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

func newScheduler(t *testing.T, database *sql.DB, options library.SchedulerOptions) *library.Scheduler {
	t.Helper()
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	return library.NewScheduler(database, library.NewQueue(database), log, options)
}

var schedulerStart = time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)

// v1 priming semantics: the first tick records the timestamp without firing;
// the job fires once the interval elapses; firing re-arms the timer.
func TestScanSchedulerPrimingAndFire(t *testing.T) {
	database := openDB(t)
	scheduler := newScheduler(t, database, library.SchedulerOptions{ScanInterval: time.Hour})
	ctx := context.Background()

	if err := scheduler.Tick(ctx, schedulerStart); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs`); got != 0 {
		t.Fatalf("priming tick must not enqueue: %d jobs", got)
	}
	var primed string
	if err := database.QueryRow(`SELECT value FROM settings WHERE key = 'last_periodic_scan'`).Scan(&primed); err != nil {
		t.Fatalf("priming timestamp: %v", err)
	}
	if want := schedulerStart.Format(time.RFC3339); primed != want {
		t.Fatalf("primed timestamp: want %q, got %q", want, primed)
	}

	// Interval not elapsed: no job.
	if err := scheduler.Tick(ctx, schedulerStart.Add(30*time.Minute)); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs`); got != 0 {
		t.Fatalf("early tick must not enqueue: %d jobs", got)
	}

	// Elapsed: exactly one scan job, timestamp re-armed at fire time.
	fireAt := schedulerStart.Add(2 * time.Hour)
	if err := scheduler.Tick(ctx, fireAt); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'scan'`); got != 1 {
		t.Fatalf("due tick must enqueue one scan: %d", got)
	}
	if err := database.QueryRow(`SELECT value FROM settings WHERE key = 'last_periodic_scan'`).Scan(&primed); err != nil {
		t.Fatalf("fire timestamp: %v", err)
	}
	if want := fireAt.Format(time.RFC3339); primed != want {
		t.Fatalf("re-armed timestamp: want %q, got %q", want, primed)
	}

	// Not due again until the next interval.
	if err := scheduler.Tick(ctx, fireAt.Add(30*time.Minute)); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'scan'`); got != 1 {
		t.Fatalf("tick before re-armed interval must not enqueue: %d", got)
	}
}

// v1 no-overlap guard: a pending or running scan/resync blocks the periodic
// scan (a resync IS a scan; stacking them would double-walk the library).
func TestScanSchedulerNoOverlapGuard(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	scheduler := newScheduler(t, database, library.SchedulerOptions{ScanInterval: time.Hour})
	ctx := context.Background()

	if err := scheduler.Tick(ctx, schedulerStart); err != nil { // prime
		t.Fatalf("tick: %v", err)
	}

	if _, err := queue.Push(ctx, library.JobTypeResync, library.ScanPayload{}); err != nil {
		t.Fatalf("push resync: %v", err)
	}
	if err := scheduler.Tick(ctx, schedulerStart.Add(2*time.Hour)); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'scan'`); got != 0 {
		t.Fatalf("pending resync must block the periodic scan: %d", got)
	}

	// Once the resync runs (claimed), the guard still sees 'running' as
	// overlap; only when nothing is pending/running may the scan fire.
	if _, err := queue.PopNext(ctx); err != nil {
		t.Fatalf("pop: %v", err)
	}
	if err := scheduler.Tick(ctx, schedulerStart.Add(3*time.Hour)); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'scan'`); got != 0 {
		t.Fatalf("running job must block the periodic scan: %d", got)
	}
}

func TestSchedulerDisabledByZeroInterval(t *testing.T) {
	database := openDB(t)
	scheduler := newScheduler(t, database, library.SchedulerOptions{})
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if err := scheduler.Tick(ctx, schedulerStart.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatalf("tick: %v", err)
		}
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs`); got != 0 {
		t.Fatalf("disabled scheduler enqueued %d jobs", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM settings`); got != 0 {
		t.Fatalf("disabled scheduler wrote %d settings", got)
	}
}

// The artist-images and ingest triggers carry their typed payloads through
// to the queued job (placeholder handlers fail them gracefully in P4b).
func TestSchedulerPlaceholderTriggersCarryPayloads(t *testing.T) {
	database := openDB(t)
	scheduler := newScheduler(t, database, library.SchedulerOptions{
		ArtistImageInterval: time.Hour,
		IngestInterval:      time.Hour,
		IngestPath:          "/srv/ingest",
	})
	ctx := context.Background()

	if err := scheduler.Tick(ctx, schedulerStart); err != nil { // prime
		t.Fatalf("tick: %v", err)
	}
	if err := scheduler.Tick(ctx, schedulerStart.Add(2*time.Hour)); err != nil {
		t.Fatalf("tick: %v", err)
	}

	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'artist_images'`); got != 1 {
		t.Fatalf("artist_images jobs: %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'ingest'`); got != 1 {
		t.Fatalf("ingest jobs: %d", got)
	}

	var payload string
	if err := database.QueryRow(`SELECT payload FROM scan_jobs WHERE type = 'artist_images'`).Scan(&payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	var artistImages library.ArtistImagesPayload
	if err := json.Unmarshal([]byte(payload), &artistImages); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !artistImages.RefetchExisting {
		t.Fatalf("artist_images payload must set refetchExisting (v1 parity): %s", payload)
	}

	if err := database.QueryRow(`SELECT payload FROM scan_jobs WHERE type = 'ingest'`).Scan(&payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	var ingest library.IngestPayload
	if err := json.Unmarshal([]byte(payload), &ingest); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if ingest.SourcePath != "/srv/ingest" {
		t.Fatalf("ingest payload must carry the configured path: %+v", ingest)
	}
}

// Review cleanup ports v1's worker.scheduleReviewCleanupIfNeeded, whose
// due-semantics DIFFER from the priming schedulers: a missing last-run
// pushes immediately (v1 treats it as 0), and the success mark is written
// by the cleanup handler, not the scheduler — so a pushed job must not be
// re-pushed while pending, and the setting stays untouched here.
func TestReviewCleanupSchedulerDueSemantics(t *testing.T) {
	database := openDB(t)
	scheduler := newScheduler(t, database, library.SchedulerOptions{ReviewCleanupInterval: 24 * time.Hour})
	ctx := context.Background()

	// No last_review_cleanup: v1 fires immediately rather than priming.
	if err := scheduler.Tick(ctx, schedulerStart); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'cleanup_review'`); got != 1 {
		t.Fatalf("first review-cleanup tick must enqueue: %d jobs", got)
	}

	// Pending job: no stacking. The scheduler does not mark the last run
	// (the handler does on success), so the pending guard is what prevents
	// duplicates — exactly v1's hasPendingOrRunningReviewCleanup.
	if err := scheduler.Tick(ctx, schedulerStart.Add(time.Hour)); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'cleanup_review'`); got != 1 {
		t.Fatalf("pending cleanup_review job must not stack: %d", got)
	}

	// Recent last run (as the handler would write): no new job.
	if _, err := database.Exec(
		`INSERT INTO settings (key, value) VALUES ('last_review_cleanup', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		schedulerStart.Add(2*time.Hour).Format(time.RFC3339)); err != nil {
		t.Fatalf("write last run: %v", err)
	}
	if err := scheduler.Tick(ctx, schedulerStart.Add(3*time.Hour)); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'cleanup_review'`); got != 1 {
		t.Fatalf("recent last run must suppress the trigger: %d", got)
	}

	// Interval elapsed, the earlier job already executed (the handler wrote
	// last_review_cleanup and the worker completed the row): exactly one
	// more job.
	if _, err := database.Exec(
		`UPDATE scan_jobs SET status = 'completed' WHERE type = 'cleanup_review'`); err != nil {
		t.Fatalf("complete job: %v", err)
	}
	if err := scheduler.Tick(ctx, schedulerStart.Add(30*time.Hour)); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'cleanup_review'`); got != 2 {
		t.Fatalf("elapsed interval must enqueue again: %d", got)
	}
}
