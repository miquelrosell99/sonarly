// HTTP routes for library runtime operations: enqueueing scans and reading
// job status. POST /api/scans is admin-gated (a scan is heavy); status is
// available to any authenticated user (the v1 web player polls it).
package library

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler wires the job queue to HTTP.
type Handler struct {
	queue *Queue
	mw    *auth.Middleware
}

func NewHandler(queue *Queue, mw *auth.Middleware) *Handler {
	return &Handler{queue: queue, mw: mw}
}

// Routes registers the scans endpoints behind session auth, the same
// composition the catalog module uses. Only POST is admin-gated; RequireAuth
// runs first so anonymous callers get 401 before the admin check would 403.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Route("/api/scans", func(r chi.Router) {
			r.With(h.mw.RequireAdmin).Post("/", h.enqueueScan)
			r.Get("/status", h.status)
		})
	})
}

func (h *Handler) enqueueScan(w http.ResponseWriter, r *http.Request) {
	id, err := h.queue.Push(r.Context(), JobTypeScan, ScanPayload{})
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true, "jobId": id})
}

// jobStatus is the public shape of a scan_jobs row; timestamps keep the raw
// datetime('now') strings v1 returned. Stats stays raw JSON so the endpoint
// forwards progress documents unchanged.
type jobStatus struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Status     string          `json:"status"`
	CreatedAt  string          `json:"createdAt,omitempty"`
	StartedAt  string          `json:"startedAt,omitempty"`
	FinishedAt string          `json:"finishedAt,omitempty"`
	Stats      json.RawMessage `json:"stats"`
	Error      string          `json:"error,omitempty"`
}

func toJobStatus(j *Job) jobStatus {
	return jobStatus{
		ID:         j.ID,
		Type:       string(j.Type),
		Status:     j.Status,
		CreatedAt:  j.CreatedAt,
		StartedAt:  j.StartedAt,
		FinishedAt: j.FinishedAt,
		Stats:      j.Stats,
		Error:      j.Error,
	}
}

// status returns the most recent job — including a queued one. v1's
// ORDER BY started_at DESC pushed pending jobs (NULL started_at) to the
// bottom, so the endpoint claimed nothing was queued while a scan waited
// behind a running job; the queue now orders by COALESCE(started_at,
// created_at).
func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	job, err := h.queue.Latest(r.Context())
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if job == nil {
		httpserver.JSON(w, http.StatusOK, map[string]any{"job": nil})
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"job": toJobStatus(job)})
}
