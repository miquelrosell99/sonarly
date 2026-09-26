// HTTP routes for ingest management and conflict cleanup, v1 parity:
//
//	GET    /api/ingest            last 100 per-file ingest rows (any user)
//	GET    /api/ingest/{id}       one row (any user)
//	DELETE /api/ingest/{id}       delete one row        (admin)
//	DELETE /api/ingest            wipe the table        (admin)
//	POST   /api/ingest/trigger    enqueue an ingest job (admin, {libraryId?})
//	GET    /api/conflicts         songs on " (n)" collision paths (admin)
//	DELETE /api/conflicts         delete those files AND rows (admin)
//
// Writes are admin-gated; reads need at least a session. Anonymous callers
// get 401 from RequireAuth before the admin check would 403.
package ingest

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// Handler wires the ingest service to HTTP.
type Handler struct {
	svc        *Service
	mw         *auth.Middleware
	ingestPath string
}

// NewHandler constructs the route handler. ingestPath is the configured
// drop folder ("" disables the trigger route's drop-dir bootstrap).
func NewHandler(svc *Service, mw *auth.Middleware, ingestPath string) *Handler {
	return &Handler{svc: svc, mw: mw, ingestPath: ingestPath}
}

// Routes registers the endpoints behind session auth. The organize preview
// is the deliberate exception: v1 left it unauthenticated, and v2 matches
// (it only answers the configured pattern).
func (h *Handler) Routes(r chi.Router) {
	h.previewRoute(r)
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Route("/api/ingest", func(r chi.Router) {
			r.Get("/", h.listJobs)
			r.Get("/{id}", h.getJob)
			r.With(h.mw.RequireAdmin).Post("/trigger", h.trigger)
			r.With(h.mw.RequireAdmin).Delete("/{id}", h.deleteJob)
			r.With(h.mw.RequireAdmin).Delete("/", h.wipeJobs)
		})
		r.Route("/api/conflicts", func(r chi.Router) {
			r.With(h.mw.RequireAdmin).Get("/", h.listConflicts)
			r.With(h.mw.RequireAdmin).Delete("/", h.deleteConflicts)
		})
		r.Route("/api/settings/media", func(r chi.Router) {
			r.Use(h.mw.RequireAdmin)
			r.Get("/", h.getMediaSettings)
			r.Patch("/", h.patchMediaSettings)
		})
		r.Route("/api/organize", func(r chi.Router) {
			r.Use(h.mw.RequireAdmin)
			r.Post("/", h.organize)
			r.Post("/job", h.organizeJob)
			r.Get("/status/{jobId}", h.organizeStatus)
		})
	})
}

func (h *Handler) listJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := h.svc.ListIngestJobs(r.Context())
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"jobs": jobs})
}

func (h *Handler) getJob(w http.ResponseWriter, r *http.Request) {
	job, err := h.svc.GetIngestJob(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if job == nil {
		httpserver.Error(w, http.StatusNotFound, "Ingest job not found")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"job": job})
}

func (h *Handler) deleteJob(w http.ResponseWriter, r *http.Request) {
	deleted, err := h.svc.DeleteIngestJob(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if !deleted {
		httpserver.Error(w, http.StatusNotFound, "Ingest job not found")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) wipeJobs(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteAllIngestJobs(r.Context()); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// trigger ports v1's POST /api/ingest/trigger: resolve the target library
// (payload's id, else the default), make sure its drop dir exists, enqueue
// the typed ingest job.
func (h *Handler) trigger(w http.ResponseWriter, r *http.Request) {
	var body struct {
		LibraryID string `json:"libraryId"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			httpserver.Error(w, http.StatusBadRequest, "Invalid input")
			return
		}
	}
	if body.LibraryID != "" {
		if _, err := uuid.Parse(body.LibraryID); err != nil {
			httpserver.Error(w, http.StatusBadRequest, "Invalid input")
			return
		}
	}

	ctx := r.Context()
	var libraryID string
	if body.LibraryID != "" {
		err := h.svc.db.QueryRowContext(ctx,
			`SELECT id FROM libraries WHERE id = ?`, body.LibraryID).Scan(&libraryID)
		if errors.Is(err, sql.ErrNoRows) {
			httpserver.Error(w, http.StatusNotFound, "Library not found")
			return
		}
		if err != nil {
			httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
			return
		}
	} else {
		err := h.svc.db.QueryRowContext(ctx,
			`SELECT id FROM libraries WHERE is_default = 1 LIMIT 1`).Scan(&libraryID)
		if err != nil {
			// No default library: nothing to ingest into.
			httpserver.Error(w, http.StatusNotFound, "Library not found")
			return
		}
	}

	if h.ingestPath == "" {
		httpserver.Error(w, http.StatusInternalServerError, "Ingest path not configured")
		return
	}
	sourcePath := filepath.Join(h.ingestPath, libraryID)
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}

	jobID, err := h.svc.queue.Push(ctx, library.JobTypeIngest, library.IngestPayload{
		SourcePath: sourcePath,
		LibraryID:  libraryID,
	})
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true, "jobId": jobID})
}

// ---------------------------------------------------------------------------
// Conflicts: songs parked on " (n)" collision paths by the organizer's
// duplicate-target resolution. v1's B5 fix (already on main) deletes the
// FILE first and the row second — a row pointing at a live file must never
// outlive it, and a gone file must never block its row's removal.
// ---------------------------------------------------------------------------

// collisionSuffixRe ports v1's COLLISION_SUFFIX_REGEX: " (digits)" right
// before the extension.
var collisionSuffixRe = regexp.MustCompile(`(?i) \(\d+\)\.[a-z0-9]+$`)

// Conflict is one collision candidate (v1 conflicts route DTO).
type Conflict struct {
	ID         string  `json:"id"`
	FilePath   string  `json:"filePath"`
	Title      string  `json:"title"`
	ArtistName *string `json:"artistName"`
	AlbumName  *string `json:"albumName"`
}

func (h *Handler) listConflicts(w http.ResponseWriter, r *http.Request) {
	conflicts, err := h.svc.ListConflicts(r.Context())
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"conflicts": conflicts})
}

func (h *Handler) deleteConflicts(w http.ResponseWriter, r *http.Request) {
	deleted, err := h.svc.DeleteConflicts(r.Context())
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Failed to delete file")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
}

// ListConflicts ports v1's listCollisionSongs + name join: active songs
// whose path ends in a collision suffix, with artist/album names.
func (s *Service) ListConflicts(ctx context.Context) ([]Conflict, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.id, s.file_path, s.title, ar.name, al.name
		 FROM songs s
		 LEFT JOIN artists ar ON ar.id = s.artist_id
		 LEFT JOIN albums al ON al.id = s.album_id
		 WHERE s.active = 1 AND s.file_path LIKE '% (%)%'`)
	if err != nil {
		return nil, fmt.Errorf("list conflicts: %w", err)
	}
	defer rows.Close()

	var conflicts []Conflict
	for rows.Next() {
		var c Conflict
		var artistName, albumName *string
		if err := rows.Scan(&c.ID, &c.FilePath, &c.Title, &artistName, &albumName); err != nil {
			return nil, fmt.Errorf("list conflicts: %w", err)
		}
		if !collisionSuffixRe.MatchString(c.FilePath) {
			continue
		}
		c.ArtistName = artistName
		c.AlbumName = albumName
		conflicts = append(conflicts, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list conflicts: %w", err)
	}
	return conflicts, nil
}

// DeleteConflicts ports v1's DELETE /api/conflicts: for every collision song
// delete the FILE first (ENOENT still removes the row — v1 B5), aborting on
// any other filesystem error, then delete the row. Junction/user rows
// cascade with the song (FK ON DELETE CASCADE).
func (s *Service) DeleteConflicts(ctx context.Context) (int, error) {
	conflicts, err := s.ListConflicts(ctx)
	if err != nil {
		return 0, err
	}
	for _, conflict := range conflicts {
		if err := os.Remove(conflict.FilePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return 0, fmt.Errorf("delete file %s: %w", conflict.FilePath, err)
		}
		if _, err := s.db.ExecContext(ctx, `DELETE FROM songs WHERE id = ?`, conflict.ID); err != nil {
			return 0, fmt.Errorf("delete song %s: %w", conflict.ID, err)
		}
	}
	return len(conflicts), nil
}
