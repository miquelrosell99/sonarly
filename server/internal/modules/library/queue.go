// Package library hosts the library runtime: the scan job queue, the
// background worker that executes scans, the filesystem watcher and the
// interval scheduler that feed it — the Go counterpart of the old
// features/library/ tree (queue.ts, worker.ts, scanner.ts, watcher.ts,
// scheduler.ts). It deliberately fixes the retired server defects called out in the
// 2026-09-24 backend architecture audit: typed job payloads (no path
// smuggling through stats), coalescing for every job type (old only coalesced
// 'resync'), transactional per-song persistence, average_rating preservation,
// and context-driven cancellation instead of process death.
package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// JobType enumerates the scan_jobs types the retired server defined. Scan and resync are
// handled by the worker itself; ingest, organize and cleanup_review have
// their handlers in the ingest module, which registers them on the worker
// (Worker.Register) so this package does not import downstream modules.
// artist_images is handled by the artistimages module (P9c).
type JobType string

const (
	JobTypeScan          JobType = "scan"
	JobTypeResync        JobType = "resync"
	JobTypeIngest        JobType = "ingest"
	JobTypeOrganize      JobType = "organize"
	JobTypeCleanupReview JobType = "cleanup_review"
	JobTypeArtistImages  JobType = "artist_images"
)

// ErrNotImplemented marks job types whose handlers land in later phases.
// The worker catches it and marks the job failed with a friendly message
// instead of retrying or crashing.
var ErrNotImplemented = errors.New("job type not implemented")

// Payloads are the typed job arguments, one struct per job type, serialized
// into scan_jobs.payload at enqueue time and decoded by the worker. This is
// the audit fix for the old stats-column smuggling: the payload has a schema,
// and a producer physically cannot pass a bare library path where an ingest
// source path belongs.

// ScanPayload is the payload for scan and resync jobs. An empty LibraryID
// scans every configured library root.
type ScanPayload struct {
	LibraryID string `json:"libraryId,omitempty"`
}

// IngestPayload is the payload for ingest jobs (handler: ingest module).
type IngestPayload struct {
	SourcePath        string `json:"sourcePath,omitempty"`
	LibraryID         string `json:"libraryId,omitempty"`
	DuplicateStrategy string `json:"duplicateStrategy,omitempty"`
}

// OrganizePayload is the payload for organize jobs (handler: ingest module).
// An empty LibraryID organizes every configured library root.
type OrganizePayload struct {
	LibraryID string `json:"libraryId,omitempty"`
}

// ArtistImagesPayload is the payload for artist_images jobs (handler: the
// artistimages module). The periodic scheduler enqueues it with
// RefetchExisting set; a plain enqueue syncs only artists missing a local
// image (old syncMissingArtistImages' default).
type ArtistImagesPayload struct {
	RefetchExisting bool `json:"refetchExisting,omitempty"`
}

// Job statuses stored in scan_jobs.status.
const (
	StatusPending   = "pending"
	StatusRunning   = "running"
	StatusCompleted = "completed"
	StatusFailed    = "failed"
)

// maxTerminalJobs mirrors the old pruneScanJobs: keep the 50 most recent
// finished jobs for diagnostics, delete the rest.
const maxTerminalJobs = 50

// Job is one scan_jobs row. Payload and Stats keep their raw JSON so callers
// decode into the typed payload structs only for the types they handle.
type Job struct {
	ID         string
	Type       JobType
	Status     string
	Payload    json.RawMessage
	Stats      json.RawMessage
	Error      string
	CreatedAt  string
	StartedAt  string
	FinishedAt string
}

// DecodePayload unmarshals the job payload into v, which must be a pointer to
// the payload struct matching j.Type.
func (j *Job) DecodePayload(v any) error {
	if len(j.Payload) == 0 {
		return nil
	}
	if err := json.Unmarshal(j.Payload, v); err != nil {
		return fmt.Errorf("decode %s payload: %w", j.Type, err)
	}
	return nil
}

// Queue persists jobs in scan_jobs. All methods are safe to call from any
// goroutine; with the single-connection pool writes serialize naturally.
type Queue struct {
	db *sql.DB
}

func NewQueue(db *sql.DB) *Queue { return &Queue{db: db} }

// Push enqueues a job, coalescing with any pending job of the same type and
// the same target. The retired server coalesced only 'resync'; here tagging a whole album
// through the watcher cannot queue one full scan per track for any job type.
// A matching pending job's id is returned and no new row is created. A job
// that is already running never matches: its walk is in flight, and the new
// push stays queued so post-walk changes are picked up by a following run.
// The payload must be the typed struct for jobType (see the Payloads block);
// it is serialized into the dedicated payload column.
func (q *Queue) Push(ctx context.Context, jobType JobType, payload any) (string, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal %s payload: %w", jobType, err)
	}

	var existingID string
	err = q.db.QueryRowContext(ctx,
		`SELECT id FROM scan_jobs
		 WHERE type = ? AND status = ? AND COALESCE(payload, '') = ?
		 ORDER BY rowid ASC LIMIT 1`,
		string(jobType), StatusPending, string(raw)).Scan(&existingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("coalesce %s job: %w", jobType, err)
	}
	if existingID != "" {
		return existingID, nil
	}

	id := uuid.NewString()
	_, err = q.db.ExecContext(ctx,
		`INSERT INTO scan_jobs (id, type, status, payload, stats, created_at)
		 VALUES (?, ?, ?, ?, NULL, datetime('now'))`,
		id, string(jobType), StatusPending, string(raw))
	if err != nil {
		return "", fmt.Errorf("enqueue %s job: %w", jobType, err)
	}
	return id, nil
}

// PopNext returns the oldest pending job and claims it for execution by
// stamping started_at. Ordering by created_at (never NULL for new rows)
// keeps FIFO insertion order; the retired server ordered by started_at, which is NULL for
// pending rows and therefore effectively rowid — same result, but the
// ordering key is now honest about what it measures.
func (q *Queue) PopNext(ctx context.Context) (*Job, error) {
	row := q.db.QueryRowContext(ctx,
		`SELECT id, type, COALESCE(payload, ''), status,
		        COALESCE(stats, ''), COALESCE(error, ''),
		        COALESCE(created_at, ''), COALESCE(started_at, ''), COALESCE(finished_at, '')
		 FROM scan_jobs
		 WHERE status = ?
		 ORDER BY created_at ASC, rowid ASC LIMIT 1`, StatusPending)
	job, err := scanJob(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("pop pending job: %w", err)
	}
	if err := q.MarkRunning(ctx, job.ID); err != nil {
		return nil, err
	}
	// Return the claimed row so StartedAt reflects the claim.
	return q.JobByID(ctx, job.ID)
}

// MarkRunning stamps a job as started.
func (q *Queue) MarkRunning(ctx context.Context, id string) error {
	res, err := q.db.ExecContext(ctx,
		`UPDATE scan_jobs SET status = ?, started_at = datetime('now') WHERE id = ?`,
		StatusRunning, id)
	if err != nil {
		return fmt.Errorf("mark job running: %w", err)
	}
	return requireAffected(res, id, "mark running")
}

// UpdateStats writes the progress JSON a long-running job reports (the old
// worker stored
// stats only at completion; the Go server worker streams counters between songs so
// /api/scans/status shows live progress).
func (q *Queue) UpdateStats(ctx context.Context, id string, stats any) error {
	raw, err := json.Marshal(stats)
	if err != nil {
		return fmt.Errorf("marshal job stats: %w", err)
	}
	res, err := q.db.ExecContext(ctx,
		`UPDATE scan_jobs SET stats = ? WHERE id = ?`, string(raw), id)
	if err != nil {
		return fmt.Errorf("update job stats: %w", err)
	}
	return requireAffected(res, id, "update stats")
}

// MarkCompleted stores the final stats and the finish timestamp.
func (q *Queue) MarkCompleted(ctx context.Context, id string, stats any) error {
	raw, err := json.Marshal(stats)
	if err != nil {
		return fmt.Errorf("marshal job stats: %w", err)
	}
	res, err := q.db.ExecContext(ctx,
		`UPDATE scan_jobs SET status = ?, finished_at = datetime('now'), stats = ?, error = NULL WHERE id = ?`,
		StatusCompleted, string(raw), id)
	if err != nil {
		return fmt.Errorf("mark job completed: %w", err)
	}
	return requireAffected(res, id, "mark completed")
}

// MarkFailed stores the error message and the finish timestamp.
func (q *Queue) MarkFailed(ctx context.Context, id, message string) error {
	res, err := q.db.ExecContext(ctx,
		`UPDATE scan_jobs SET status = ?, finished_at = datetime('now'), error = ? WHERE id = ?`,
		StatusFailed, message, id)
	if err != nil {
		return fmt.Errorf("mark job failed: %w", err)
	}
	return requireAffected(res, id, "mark failed")
}

// FailStaleRunning sweeps jobs left in 'running' by a previous process that
// died mid-job (wire parity: the worker sweeps at boot). Returns the swept
// count.
func (q *Queue) FailStaleRunning(ctx context.Context) (int64, error) {
	res, err := q.db.ExecContext(ctx,
		`UPDATE scan_jobs SET status = ?, finished_at = datetime('now'),
			error = 'worker restarted while job was running'
		 WHERE status = ?`, StatusFailed, StatusRunning)
	if err != nil {
		return 0, fmt.Errorf("fail stale running jobs: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// PruneTerminal keeps the newest keep terminal jobs (by insertion) and
// deletes older completed/failed rows.
func (q *Queue) PruneTerminal(ctx context.Context, keep int) error {
	_, err := q.db.ExecContext(ctx,
		`DELETE FROM scan_jobs
		 WHERE status IN (?, ?)
		   AND rowid NOT IN (
		     SELECT rowid FROM scan_jobs
		     WHERE status IN (?, ?)
		     ORDER BY rowid DESC LIMIT ?
		   )`, StatusCompleted, StatusFailed, StatusCompleted, StatusFailed, keep)
	if err != nil {
		return fmt.Errorf("prune terminal jobs: %w", err)
	}
	return nil
}

// Latest returns the most recent job by COALESCE(started_at, created_at):
// pending jobs surface immediately instead of hiding under NULL started_at
// the way they did in the old ORDER BY started_at status endpoint. Returns
// nil when no job exists yet.
func (q *Queue) Latest(ctx context.Context) (*Job, error) {
	row := q.db.QueryRowContext(ctx,
		`SELECT id, type, COALESCE(payload, ''), status,
		        COALESCE(stats, ''), COALESCE(error, ''),
		        COALESCE(created_at, ''), COALESCE(started_at, ''), COALESCE(finished_at, '')
		 FROM scan_jobs
		 ORDER BY COALESCE(started_at, created_at) DESC, rowid DESC LIMIT 1`)
	job, err := scanJob(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load latest job: %w", err)
	}
	return job, nil
}

// JobByID loads one job for tests and diagnostics.
func (q *Queue) JobByID(ctx context.Context, id string) (*Job, error) {
	row := q.db.QueryRowContext(ctx,
		`SELECT id, type, COALESCE(payload, ''), status,
		        COALESCE(stats, ''), COALESCE(error, ''),
		        COALESCE(created_at, ''), COALESCE(started_at, ''), COALESCE(finished_at, '')
		 FROM scan_jobs WHERE id = ?`, id)
	job, err := scanJob(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load job %s: %w", id, err)
	}
	return job, nil
}

// scanJob reads one job row. Payload and Stats come back as strings from the
// driver and become json.RawMessage here — database/sql cannot scan a
// driver string into *json.RawMessage directly. Empty strings become nil so
// the DTO marshals them as JSON null (an empty RawMessage is invalid JSON
// and would fail encoding).
func scanJob(row interface{ Scan(...any) error }) (*Job, error) {
	var job Job
	var payload, stats string
	if err := row.Scan(&job.ID, &job.Type, &payload, &job.Status,
		&stats, &job.Error, &job.CreatedAt, &job.StartedAt, &job.FinishedAt); err != nil {
		return nil, err
	}
	if payload != "" {
		job.Payload = json.RawMessage(payload)
	}
	if stats != "" {
		job.Stats = json.RawMessage(stats)
	}
	return &job, nil
}

func requireAffected(res sql.Result, id, op string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if n == 0 {
		return fmt.Errorf("%s: no scan_jobs row with id %s", op, id)
	}
	return nil
}
