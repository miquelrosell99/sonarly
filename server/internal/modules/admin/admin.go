// Package admin is the v1 admin surface (P9c): system-tasks (definitions,
// manual run, paginated history), the admin status dashboard, the
// missing-file management endpoints, and the ingest-runs views — ported
// from v1's features/users/admin-routes.ts.
package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// systemTaskStatus is the v1 SystemTaskStatus union.
type systemTaskStatus string

// TaskIntervals carries the configured scheduler intervals; a
// non-positive interval surfaces as null (task disabled, v1 semantics).
type TaskIntervals struct {
	ScanInterval          time.Duration
	ArtistImageInterval   time.Duration
	IngestInterval        time.Duration
	ReviewCleanupInterval time.Duration
	IngestPath            string
}

// Service runs the admin queries.
type Service struct {
	db        *sql.DB
	queue     *library.Queue
	intervals TaskIntervals
}

// NewService constructs the admin service.
func NewService(db *sql.DB, queue *library.Queue, intervals TaskIntervals) *Service {
	return &Service{db: db, queue: queue, intervals: intervals}
}

// taskStatus is one task's status row (v1 getLatestJobStatus).
type taskStatus struct {
	Status    *systemTaskStatus `json:"status"`
	LastRunAt *string           `json:"lastRunAt"`
}

// latestJobStatus ports getLatestJobStatus: the newest scan_jobs row of any
// of the given types.
func (s *Service) latestJobStatus(ctx context.Context, types []library.JobType) (taskStatus, error) {
	var out taskStatus
	if len(types) == 0 {
		return out, nil
	}
	placeholders := ""
	args := make([]any, 0, len(types))
	for i, t := range types {
		if i > 0 {
			placeholders += ", "
		}
		placeholders += "?"
		args = append(args, string(t))
	}
	var status string
	var finishedAt *string
	err := s.db.QueryRowContext(ctx,
		`SELECT status, finished_at FROM scan_jobs WHERE type IN (`+placeholders+`) ORDER BY rowid DESC LIMIT 1`,
		args...).Scan(&status, &finishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	st := systemTaskStatus(status)
	out.Status = &st
	if finishedAt != nil && *finishedAt != "" {
		out.LastRunAt = finishedAt
	}
	return out, nil
}

// getSetting reads one settings row (missing → "").
func (s *Service) getSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

// taskDefinition is v1's SystemTaskDefinition, resolved against config.
type taskDefinition struct {
	id              string
	name            string
	description     string
	jobTypes        []library.JobType
	intervalMinutes *int
	fallbackSetting string // settings key consulted when no job row exists
	run             func(ctx context.Context) error
}

func minutesPtr(d time.Duration) *int {
	if d <= 0 {
		return nil
	}
	m := int(d / time.Minute)
	return &m
}

// definitions is v1's getSystemTasks(config).
func (s *Service) definitions() []taskDefinition {
	return []taskDefinition{
		{
			id: "periodic_scan", name: "Periodic library scan",
			description:     "Scans the library for new, changed, or removed audio files.",
			jobTypes:        []library.JobType{library.JobTypeScan, library.JobTypeResync},
			intervalMinutes: minutesPtr(s.intervals.ScanInterval),
			run: func(ctx context.Context) error {
				_, err := s.queue.Push(ctx, library.JobTypeScan, library.ScanPayload{})
				return err
			},
		},
		{
			id: "review_cleanup", name: "Review folder cleanup",
			description:     "Deletes files from the ingest review folder that are older than the retention period.",
			jobTypes:        []library.JobType{library.JobTypeCleanupReview},
			intervalMinutes: minutesPtr(24 * time.Hour),
			fallbackSetting: "last_review_cleanup",
			run: func(ctx context.Context) error {
				_, err := s.queue.Push(ctx, library.JobTypeCleanupReview, struct{}{})
				return err
			},
		},
		{
			id: "artist_images", name: "Artist image sync",
			description:     "Fetches missing artist cover images from an external provider.",
			jobTypes:        []library.JobType{library.JobTypeArtistImages},
			intervalMinutes: minutesPtr(s.intervals.ArtistImageInterval),
			fallbackSetting: "last_artist_image_sync",
			run: func(ctx context.Context) error {
				_, err := s.queue.Push(ctx, library.JobTypeArtistImages, library.ArtistImagesPayload{})
				return err
			},
		},
		{
			id: "ingest", name: "Ingest",
			description:     "Processes files in the ingest folder and imports them into the library.",
			jobTypes:        []library.JobType{library.JobTypeIngest},
			intervalMinutes: minutesPtr(s.intervals.IngestInterval),
			run: func(ctx context.Context) error {
				_, err := s.queue.Push(ctx, library.JobTypeIngest, library.IngestPayload{SourcePath: s.intervals.IngestPath})
				return err
			},
		},
	}
}

// SystemTask is the v1 SystemTask response DTO.
type SystemTask struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Description     string            `json:"description"`
	IntervalMinutes *int              `json:"intervalMinutes"`
	LastRunAt       *string           `json:"lastRunAt"`
	Status          *systemTaskStatus `json:"status"`
}

// ListSystemTasks ports v1's GET /api/admin/system-tasks.
func (s *Service) ListSystemTasks(ctx context.Context) ([]SystemTask, error) {
	tasks := []SystemTask{}
	for _, def := range s.definitions() {
		status, err := s.latestJobStatus(ctx, def.jobTypes)
		if err != nil {
			return nil, err
		}
		lastRunAt := status.LastRunAt
		if lastRunAt == nil && def.fallbackSetting != "" {
			if value, err := s.getSetting(ctx, def.fallbackSetting); err != nil {
				return nil, err
			} else if value != "" {
				lastRunAt = &value
			}
		}
		tasks = append(tasks, SystemTask{
			ID: def.id, Name: def.name, Description: def.description,
			IntervalMinutes: def.intervalMinutes, LastRunAt: lastRunAt, Status: status.Status,
		})
	}
	return tasks, nil
}

// RunSystemTask ports v1's POST /api/admin/system-tasks/:taskId/run.
func (s *Service) RunSystemTask(ctx context.Context, taskID string) error {
	for _, def := range s.definitions() {
		if def.id == taskID {
			return def.run(ctx)
		}
	}
	return errTaskNotFound
}

var errTaskNotFound = errors.New("task not found")

// validTaskIDs is v1's z.enum([...]) — the run route validates against it
// before the lookup so a bad id answers 400 like v1.
var validTaskIDs = map[string]bool{
	"periodic_scan": true, "review_cleanup": true, "artist_images": true, "ingest": true,
}

// HistoryEntry is one row of the system-tasks history (v1 shape).
type HistoryEntry struct {
	ID         string          `json:"id"`
	Task       string          `json:"task"`
	Type       string          `json:"type"`
	Status     string          `json:"status"`
	StartedAt  *string         `json:"startedAt"`
	FinishedAt *string         `json:"finishedAt"`
	Stats      json.RawMessage `json:"stats,omitempty"`
}

// HistoryPage is v1's paginated history response — the only paginated v1
// endpoint, shape preserved.
type HistoryPage struct {
	History    []HistoryEntry `json:"history"`
	Page       int            `json:"page"`
	Limit      int            `json:"limit"`
	Total      int            `json:"total"`
	TotalPages int            `json:"totalPages"`
}

// systemTaskTypes is v1's history filter list.
var systemTaskTypes = []library.JobType{
	library.JobTypeScan, library.JobTypeResync, library.JobTypeCleanupReview,
	library.JobTypeArtistImages, library.JobTypeIngest,
}

// taskNameByType is v1's display-name map.
var taskNameByType = map[string]string{
	"scan":           "Periodic library scan",
	"resync":         "Periodic library scan",
	"cleanup_review": "Review folder cleanup",
	"artist_images":  "Artist image sync",
	"ingest":         "Ingest",
}

// SystemTaskHistory ports v1's GET /api/admin/system-tasks/history.
func (s *Service) SystemTaskHistory(ctx context.Context, page, limit int) (*HistoryPage, error) {
	placeholders := ""
	args := make([]any, 0, len(systemTaskTypes))
	for i, t := range systemTaskTypes {
		if i > 0 {
			placeholders += ", "
		}
		placeholders += "?"
		args = append(args, string(t))
	}
	offset := (page - 1) * limit

	rows, err := s.db.QueryContext(ctx,
		`SELECT id, type, status, started_at, finished_at, stats
		 FROM scan_jobs WHERE type IN (`+placeholders+`)
		 ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?`,
		append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []HistoryEntry{}
	for rows.Next() {
		var entry HistoryEntry
		var startedAt, finishedAt *string
		var stats *string
		if err := rows.Scan(&entry.ID, &entry.Type, &entry.Status, &startedAt, &finishedAt, &stats); err != nil {
			return nil, err
		}
		entry.StartedAt = startedAt
		entry.FinishedAt = finishedAt
		if stats != nil && *stats != "" {
			entry.Stats = json.RawMessage(*stats)
		}
		entry.Task = taskNameByType[entry.Type]
		if entry.Task == "" {
			entry.Task = entry.Type
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM scan_jobs WHERE type IN (`+placeholders+`)`, args...).Scan(&total); err != nil {
		return nil, err
	}
	return &HistoryPage{
		History: entries, Page: page, Limit: limit, Total: total,
		TotalPages: (total + limit - 1) / limit,
	}, nil
}

// ---------------------------------------------------------------------------
// HTTP wiring
// ---------------------------------------------------------------------------

// Handler wires the admin endpoints to HTTP (admin-gated, v1 parity).
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

// NewHandler constructs the route handler.
func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers the admin endpoints behind auth + admin.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth, h.mw.RequireAdmin)

		r.Route("/api/admin/system-tasks", func(r chi.Router) {
			r.Get("/", h.listTasks)
			r.Get("/history", h.taskHistory)
			r.Post("/{taskId}/run", h.runTask)
		})
		r.Get("/api/admin/status", h.status)
		r.Get("/api/admin/missing", h.missing)
		r.Delete("/api/admin/missing/songs/{id}", h.deleteMissingSong)
		r.Delete("/api/admin/missing/albums/{id}", h.deleteMissingAlbum)
		r.Delete("/api/admin/missing/artists/{id}", h.deleteMissingArtist)
		r.Delete("/api/admin/missing/songs", h.deleteAllMissingSongs)
		r.Delete("/api/admin/missing/albums", h.deleteAllMissingAlbums)
		r.Delete("/api/admin/missing/artists", h.deleteAllMissingArtists)

		r.Get("/api/admin/ingest-runs", h.ingestRuns)
		r.Route("/api/admin/ingest-runs/{id}", func(r chi.Router) {
			r.Get("/", h.ingestRun)
			r.Delete("/", h.deleteIngestRun)
		})
		r.Delete("/api/admin/ingest-runs", h.deleteAllIngestRuns)
	})
}

func (h *Handler) listTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := h.svc.ListSystemTasks(r.Context())
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if tasks == nil {
		tasks = []SystemTask{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (h *Handler) runTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if !validTaskIDs[taskID] {
		httpserver.Error(w, http.StatusBadRequest, "Invalid task id")
		return
	}
	if err := h.svc.RunSystemTask(r.Context(), taskID); err != nil {
		if errors.Is(err, errTaskNotFound) {
			httpserver.Error(w, http.StatusNotFound, "Task not found")
			return
		}
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

func (h *Handler) taskHistory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := parsePositiveInt(q.Get("page"), 1)
	limit := parsePositiveInt(q.Get("limit"), 10)
	if limit > 100 {
		limit = 100
	}
	history, err := h.svc.SystemTaskHistory(r.Context(), page, limit)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, history)
}

// parsePositiveInt ports v1's Math.max(1, parseInt(...) || default).
func parsePositiveInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return fallback
	}
	return n
}
