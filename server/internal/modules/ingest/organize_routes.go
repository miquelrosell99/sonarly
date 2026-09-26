// Organize HTTP routes (P9c): v1's features/ingest/organize-routes.ts shape
// over the P7b organize job — POST /api/organize and /api/organize/job
// enqueue (the job runs on the worker, never inline: running it on the
// request goroutine would stall streaming and race the worker, the v1
// lesson the route comment recorded), GET /api/organize/preview answers the
// effective pattern, and GET /api/organize/status/{jobId} reports one job.
package ingest

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// OrganizeJobStatus is v1's OrganizeJobStatus DTO.
type OrganizeJobStatus struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Status     string          `json:"status"`
	StartedAt  *string         `json:"startedAt,omitempty"`
	FinishedAt *string         `json:"finishedAt,omitempty"`
	Stats      json.RawMessage `json:"stats,omitempty"`
}

// previewRoute registers GET /api/organize/preview EXACTLY like v1: the
// route has no session or admin gate in v1 (it only answers the configured
// pattern), so it stays public here too.
func (h *Handler) previewRoute(r chi.Router) {
	r.Get("/api/organize/preview", h.organizePreview)
}

// organize is v1's POST /api/organize: enqueue and answer 202.
func (h *Handler) organize(w http.ResponseWriter, r *http.Request) {
	jobID, err := h.svc.queue.Push(r.Context(), library.JobTypeOrganize, library.OrganizePayload{})
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusAccepted, map[string]any{"jobId": jobID})
}

// organizeJob is v1's POST /api/organize/job: same enqueue, 200 like v1.
func (h *Handler) organizeJob(w http.ResponseWriter, r *http.Request) {
	jobID, err := h.svc.queue.Push(r.Context(), library.JobTypeOrganize, library.OrganizePayload{})
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"jobId": jobID})
}

// organizePreview is v1's GET /api/organize/preview: the effective pattern.
func (h *Handler) organizePreview(w http.ResponseWriter, r *http.Request) {
	httpserver.JSON(w, http.StatusOK, map[string]any{
		"pattern": h.svc.globalOrganizePattern(r.Context()),
	})
}

// organizeStatus is v1's GET /api/organize/status/:jobId: 404 unless the id
// names an organize job.
func (h *Handler) organizeStatus(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "jobId")
	row := h.svc.db.QueryRowContext(r.Context(),
		`SELECT id, type, status, started_at, finished_at, stats
		 FROM scan_jobs WHERE id = ? AND type = 'organize'`, jobID)
	var job OrganizeJobStatus
	var startedAt, finishedAt, stats *string
	err := row.Scan(&job.ID, &job.Type, &job.Status, &startedAt, &finishedAt, &stats)
	if errors.Is(err, sql.ErrNoRows) {
		httpserver.Error(w, http.StatusNotFound, "Job not found")
		return
	}
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	job.StartedAt, job.FinishedAt = startedAt, finishedAt
	if stats != nil && *stats != "" {
		job.Stats = json.RawMessage(*stats)
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"job": job})
}
