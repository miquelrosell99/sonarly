// Worker executes scan_jobs one at a time on a single goroutine. v1 needed
// an OS thread (worker_threads) for CPU-heavy scans; Go runs the loop on a
// plain goroutine. The loop is context-driven: shutting the server down
// (signal.NotifyContext in main) cancels the scan between songs, rolls back
// the in-flight per-song transaction, and marks the job failed.
package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// defaultPollInterval is how long the loop waits between queue checks when
// idle — a timer-based sleep, never a hot loop.
const defaultPollInterval = time.Second

// Event is published on the worker's events channel every time a job reaches
// a terminal state. It exists for the future SSE feed (v1's job:completed
// worker message that app.ts rebroadcast as library:changed).
type Event struct {
	JobID string
	Type  JobType
	Stats json.RawMessage
	// Error is empty on success.
	Error string
}

// Worker polls the queue and executes jobs. Exactly one Worker runs per
// process; the single-connection DB pool serializes its writes.
type Worker struct {
	queue    *Queue
	scanner  *Scanner
	log      *slog.Logger
	poll     time.Duration
	events   chan Event
	handlers map[JobType]JobHandler
}

// JobHandler executes one claimed job. It returns the stats document the
// queue stores on completion (nil is valid) and the execution error, if
// any. Modules with job types the worker must not know about (ingest,
// organize, review cleanup) register a handler instead of importing the
// worker — the dependency points inward.
type JobHandler func(ctx context.Context, job *Job) (any, error)

func NewWorker(queue *Queue, scanner *Scanner, log *slog.Logger) *Worker {
	return &Worker{
		queue:    queue,
		scanner:  scanner,
		log:      log,
		poll:     defaultPollInterval,
		events:   make(chan Event, 16),
		handlers: map[JobType]JobHandler{},
	}
}

// Register installs the handler for a job type. It must be called before
// Start; registration afterwards races the polling loop. Job types with a
// registered handler never surface ErrNotImplemented. Passing a nil handler
// unregisters the type (back to the placeholder behavior).
func (w *Worker) Register(jobType JobType, fn JobHandler) {
	if fn == nil {
		delete(w.handlers, jobType)
		return
	}
	w.handlers[jobType] = fn
}

// Events returns the job-completion stream. Sends never block the worker: a
// consumer that falls behind drops events (logged), so the SSE adapter must
// keep up or reconcile from the queue table.
func (w *Worker) Events() <-chan Event { return w.events }

func (w *Worker) emit(ev Event) {
	select {
	case w.events <- ev:
	default:
		w.log.Warn("job event dropped: consumer not keeping up", "job_id", ev.JobID, "type", ev.Type)
	}
}

// Start runs the loop until ctx is cancelled. It first sweeps jobs a
// previous process left 'running' (crash mid-job), like v1's worker boot.
func (w *Worker) Start(ctx context.Context) {
	if n, err := w.queue.FailStaleRunning(ctx); err != nil {
		w.log.ErrorContext(ctx, "stale job sweep failed", "err", err)
	} else if n > 0 {
		w.log.InfoContext(ctx, "failed stale running jobs at boot", "count", n)
	}
	for {
		if err := ctx.Err(); err != nil {
			w.log.InfoContext(ctx, "worker stopped")
			return
		}
		job, err := w.queue.PopNext(ctx)
		if err != nil {
			w.log.ErrorContext(ctx, "pop next job failed", "err", err)
			w.wait(ctx)
			continue
		}
		if job == nil {
			w.wait(ctx)
			continue
		}
		w.runJob(ctx, job)
	}
}

func (w *Worker) wait(ctx context.Context) {
	timer := time.NewTimer(w.poll)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

func (w *Worker) runJob(ctx context.Context, job *Job) {
	started := time.Now()
	w.log.InfoContext(ctx, "job started", "job_id", job.ID, "type", job.Type)
	stats, err := w.execute(ctx, job)
	duration := time.Since(started).Round(time.Millisecond)

	// Terminal-state writes run on a context the shutdown cancellation does
	// not kill: the job row must record its outcome even when the scan was
	// aborted by shutdown (v1 could write synchronously; the Go worker must
	// explicitly detach from the cancelled ctx).
	record := context.WithoutCancel(ctx)

	switch {
	case err == nil:
		if mErr := w.queue.MarkCompleted(record, job.ID, stats); mErr != nil {
			w.log.ErrorContext(ctx, "mark job completed failed", "job_id", job.ID, "err", mErr)
		}
		w.log.InfoContext(ctx, "job completed", "job_id", job.ID, "type", job.Type,
			"duration_ms", duration.Milliseconds(), "stats", stats)
		w.emit(Event{JobID: job.ID, Type: job.Type, Stats: mustJSON(stats)})

	case errors.Is(err, ErrNotImplemented):
		// Enqueue-able placeholder types fail gracefully: the job is marked
		// failed with an explanatory message so /api/scans/status is honest.
		message := fmt.Sprintf("%s: not implemented yet (lands in a later phase)", job.Type)
		w.failIfStillRunning(record, job.ID, message)
		w.log.InfoContext(ctx, "job not implemented", "job_id", job.ID, "type", job.Type, "duration_ms", duration.Milliseconds())
		w.emit(Event{JobID: job.ID, Type: job.Type, Error: message})

	case errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded):
		// Shutdown mid-scan: the scanner aborted between songs and its
		// in-flight tx rolled back. Mark the job failed unless it raced to
		// a terminal state (v1's shutdown check).
		w.failIfStillRunning(record, job.ID, "cancelled: server shutting down")
		w.log.InfoContext(ctx, "job cancelled by shutdown", "job_id", job.ID, "type", job.Type,
			"duration_ms", duration.Milliseconds())
		w.emit(Event{JobID: job.ID, Type: job.Type, Stats: mustJSON(stats), Error: "cancelled: server shutting down"})

	default:
		if mErr := w.queue.MarkFailed(record, job.ID, err.Error()); mErr != nil {
			w.log.ErrorContext(ctx, "mark job failed failed", "job_id", job.ID, "err", mErr)
		}
		w.log.ErrorContext(ctx, "job failed", "job_id", job.ID, "type", job.Type,
			"duration_ms", duration.Milliseconds(), "err", err)
		w.emit(Event{JobID: job.ID, Type: job.Type, Stats: mustJSON(stats), Error: err.Error()})
	}

	if err := w.queue.PruneTerminal(record, maxTerminalJobs); err != nil {
		w.log.ErrorContext(ctx, "prune terminal jobs failed", "err", err)
	}
}

// execute decodes the typed payload and dispatches. Stats are returned even
// on error so failed jobs keep their partial progress.
func (w *Worker) execute(ctx context.Context, job *Job) (any, error) {
	if fn, ok := w.handlers[job.Type]; ok {
		return fn(ctx, job)
	}
	switch job.Type {
	case JobTypeScan, JobTypeResync:
		var payload ScanPayload
		if err := job.DecodePayload(&payload); err != nil {
			return nil, err
		}
		stats, err := w.scanner.Scan(ctx, payload, func(s *ScanStats) {
			// Best-effort live progress; a cancelled context simply
			// stops the updates.
			_ = w.queue.UpdateStats(ctx, job.ID, s)
		})
		if stats == nil {
			stats = &ScanStats{}
		}
		return stats, err
	default:
		return nil, ErrNotImplemented
	}
}

// failIfStillRunning mirrors v1's shutdown handling: only clobber the job
// when it never reached a terminal state.
func (w *Worker) failIfStillRunning(ctx context.Context, id, message string) {
	current, err := w.queue.JobByID(ctx, id)
	if err != nil || current == nil {
		if err != nil {
			w.log.ErrorContext(ctx, "reload job status failed", "job_id", id, "err", err)
		}
		return
	}
	if current.Status != StatusCompleted && current.Status != StatusFailed {
		if err := w.queue.MarkFailed(ctx, id, message); err != nil {
			w.log.ErrorContext(ctx, "mark job failed failed", "job_id", id, "err", err)
		}
	}
}

func mustJSON(v any) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return raw
}
