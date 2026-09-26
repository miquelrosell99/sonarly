package library_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// The audit's coalescing fix: v1 only coalesced 'resync', so tagging a whole
// album queued one scan per track. v2 coalesces any pending job with the
// same type AND target.
func TestPushCoalescesSameTypeAndTarget(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	ctx := context.Background()

	id1, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	id2, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("coalescing: want same job id, got %q and %q", id1, id2)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs`); got != 1 {
		t.Fatalf("want 1 job row, got %d", got)
	}

	// A finished job never coalesces; a new push after completion queues.
	if err := queue.MarkRunning(ctx, id1); err != nil {
		t.Fatalf("mark running: %v", err)
	}
	if err := queue.MarkCompleted(ctx, id1, library.ScanStats{Scanned: 1}); err != nil {
		t.Fatalf("mark completed: %v", err)
	}
	id3, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if id3 == id1 {
		t.Fatalf("completed job must not absorb a new push")
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs`); got != 2 {
		t.Fatalf("want 2 job rows, got %d", got)
	}
}

func TestPushCoalescingMatchesTarget(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	ctx := context.Background()

	a, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{LibraryID: "lib-a"})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	b, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{LibraryID: "lib-b"})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if a == b {
		t.Fatalf("different targets must queue separately")
	}
	again, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{LibraryID: "lib-a"})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if again != a {
		t.Fatalf("same target must coalesce")
	}
	// Same target expressed in the typed payload, different job type: queues.
	resync, err := queue.Push(ctx, library.JobTypeResync, library.ScanPayload{LibraryID: "lib-a"})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if resync == a {
		t.Fatalf("different job type must queue separately")
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE status = 'pending'`); got != 3 {
		t.Fatalf("want 3 pending jobs, got %d", got)
	}
}

// Typed payload round-trip: what the producer marshals is what the worker
// decodes — v1's stats-column path smuggling cannot happen because the
// payload column carries a schema'd document.
func TestPayloadRoundTrip(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	ctx := context.Background()

	want := library.IngestPayload{SourcePath: "/drop", LibraryID: "lib-1", DuplicateStrategy: "review"}
	id, err := queue.Push(ctx, library.JobTypeIngest, want)
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	job, err := queue.PopNext(ctx)
	if err != nil {
		t.Fatalf("pop: %v", err)
	}
	if job == nil || job.ID != id {
		t.Fatalf("want job %s, got %+v", id, job)
	}
	var got library.IngestPayload
	if err := job.DecodePayload(&got); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if got != want {
		t.Fatalf("payload round trip: want %+v, got %+v", want, got)
	}
}

func TestPopNextIsFIFOAndClaims(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	ctx := context.Background()

	ids := []string{}
	for _, p := range []library.ScanPayload{{}, {LibraryID: "lib-a"}, {LibraryID: "lib-b"}} {
		id, err := queue.Push(ctx, library.JobTypeScan, p)
		if err != nil {
			t.Fatalf("push: %v", err)
		}
		ids = append(ids, id)
		time.Sleep(5 * time.Millisecond) // distinct created_at
	}
	for i, wantID := range ids {
		job, err := queue.PopNext(ctx)
		if err != nil {
			t.Fatalf("pop %d: %v", i, err)
		}
		if job.ID != wantID {
			t.Fatalf("pop %d: want %s, got %s", i, wantID, job.ID)
		}
		if job.Status != library.StatusRunning {
			t.Fatalf("pop must claim the job: status %q", job.Status)
		}
		if job.StartedAt == "" {
			t.Fatalf("claimed job must have started_at")
		}
	}
	if job, err := queue.PopNext(ctx); err != nil || job != nil {
		t.Fatalf("empty queue: want nil job, got %+v (err %v)", job, err)
	}
}

func TestFailStaleRunning(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	ctx := context.Background()

	id, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if err := queue.MarkRunning(ctx, id); err != nil {
		t.Fatalf("mark running: %v", err)
	}

	n, err := queue.FailStaleRunning(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("want 1 swept job, got %d", n)
	}
	job, err := queue.JobByID(ctx, id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if job.Status != library.StatusFailed {
		t.Fatalf("want failed, got %q", job.Status)
	}
	if job.Error == "" || !strings.Contains(job.Error, "restarted") {
		t.Fatalf("sweep error message: %q", job.Error)
	}
}

func TestPruneTerminalKeepsNewest(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	ctx := context.Background()

	keep := 3
	for i := 0; i < 10; i++ {
		id, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{})
		if err != nil {
			t.Fatalf("push: %v", err)
		}
		if err := queue.MarkRunning(ctx, id); err != nil {
			t.Fatalf("mark running: %v", err)
		}
		if err := queue.MarkCompleted(ctx, id, library.ScanStats{Scanned: i}); err != nil {
			t.Fatalf("complete: %v", err)
		}
	}
	// A running job is not terminal and must survive pruning.
	running, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{LibraryID: "other"})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if err := queue.MarkRunning(ctx, running); err != nil {
		t.Fatalf("mark running: %v", err)
	}

	if err := queue.PruneTerminal(ctx, keep); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE status IN ('completed','failed')`); got != keep {
		t.Fatalf("want %d terminal rows, got %d", keep, got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE status = 'running'`); got != 1 {
		t.Fatalf("running job must survive pruning, got %d", got)
	}
	// The surviving terminal rows are the newest: stats hold 7, 8, 9.
	var scanned []int
	rows, err := database.Query(`SELECT stats FROM scan_jobs WHERE status = 'completed' ORDER BY rowid`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			t.Fatalf("scan: %v", err)
		}
		var stats library.ScanStats
		if err := json.Unmarshal([]byte(raw), &stats); err != nil {
			t.Fatalf("unmarshal stats: %v", err)
		}
		scanned = append(scanned, stats.Scanned)
	}
	if len(scanned) != keep || scanned[0] != 7 || scanned[keep-1] != 9 {
		t.Fatalf("prune kept wrong rows: %v", scanned)
	}
}

// The status endpoint must see queued jobs: v1 ordered by started_at, which
// is NULL until a job runs, so pending jobs sank to the bottom and the
// endpoint hid them.
func TestLatestSurfacesPendingJob(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	ctx := context.Background()

	id, err := queue.Push(ctx, library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	job, err := queue.Latest(ctx)
	if err != nil {
		t.Fatalf("latest: %v", err)
	}
	if job == nil || job.ID != id {
		t.Fatalf("latest must return the pending job, got %+v", job)
	}
	if job.Status != library.StatusPending {
		t.Fatalf("want pending, got %q", job.Status)
	}
	if job.StartedAt != "" {
		t.Fatalf("pending job must not have started_at, got %q", job.StartedAt)
	}
	if job.CreatedAt == "" {
		t.Fatalf("pending job must carry created_at")
	}

	// Once the job runs, the finished job outranks the pending one.
	if err := queue.MarkRunning(ctx, id); err != nil {
		t.Fatalf("mark running: %v", err)
	}
	if err := queue.MarkCompleted(ctx, id, library.ScanStats{Added: 4}); err != nil {
		t.Fatalf("complete: %v", err)
	}
	job, err = queue.Latest(ctx)
	if err != nil {
		t.Fatalf("latest: %v", err)
	}
	if job.Status != library.StatusCompleted || job.FinishedAt == "" {
		t.Fatalf("want completed with finished_at, got %+v", job)
	}
	var stats library.ScanStats
	if err := json.Unmarshal(job.Stats, &stats); err != nil {
		t.Fatalf("stats must round-trip: %v", err)
	}
	if stats.Added != 4 {
		t.Fatalf("stats: %+v", stats)
	}
}

func TestLatestEmpty(t *testing.T) {
	database := openDB(t)
	queue := library.NewQueue(database)
	job, err := queue.Latest(context.Background())
	if err != nil {
		t.Fatalf("latest: %v", err)
	}
	if job != nil {
		t.Fatalf("want nil, got %+v", job)
	}
}
