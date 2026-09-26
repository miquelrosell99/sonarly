// Cover-art upload and unlink (P9c): the v2 port of v1's
// POST/DELETE /api/songs/:id/cover-art and /api/albums/:id/cover-art.
//
// v1 trusted the multipart mimetype; v2 sniffs magic bytes (jpeg/png/webp)
// — the frontend-audit fix: a renamed executable must never become a
// stored blob. v1 also embedded the uploaded art into every audio file via
// mutagen; the read-only doctrine defers that: the blob is stored
// hash-dedup and linked on the song/album row, which is what all readers
// consult. Embedded-art parity is a documented deferral (writing art into
// files is tag editing, not linking).
package tags

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// maxCoverArtBytes mirrors v1's 2 MiB cap.
const maxCoverArtBytes = 2 * 1024 * 1024

// sniffImageFormat identifies jpeg/png/webp by magic bytes. The returned
// string is the MIME type stored on the cover_arts row; ok is false for
// anything else (HTML error pages, executables, truncated files).
func sniffImageFormat(data []byte) (mime string, ok bool) {
	switch {
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg", true
	case len(data) >= 4 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4e && data[3] == 0x47:
		return "image/png", true
	case len(data) >= 12 &&
		data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 && // "RIFF"
		data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50: // "WEBP"
		return "image/webp", true
	}
	return "", false
}

// readCoverArtBody bounds and reads the raw upload body, then sniffs it.
func readCoverArtBody(w http.ResponseWriter, r *http.Request) ([]byte, string, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCoverArtBytes+1))
	if err != nil || len(body) == 0 {
		httpserver.Error(w, http.StatusBadRequest, "No file uploaded")
		return nil, "", false
	}
	if len(body) > maxCoverArtBytes {
		httpserver.Error(w, http.StatusBadRequest, "Cover art must be smaller than 2 MB")
		return nil, "", false
	}
	mime, ok := sniffImageFormat(body)
	if !ok {
		httpserver.Error(w, http.StatusBadRequest, "Invalid image format")
		return nil, "", false
	}
	return body, mime, true
}

// songCoverArtID loads a song's current cover link (nil when unset).
func (s *Service) songCoverArtID(ctx context.Context, songID string) (*string, error) {
	var id *string
	err := s.db.QueryRowContext(ctx,
		`SELECT cover_art_id FROM songs WHERE id = ?`, songID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return id, nil
}

// albumCoverArtID loads an album's current cover link.
func (s *Service) albumCoverArtID(ctx context.Context, albumID string) (*string, error) {
	var id *string
	err := s.db.QueryRowContext(ctx,
		`SELECT cover_art_id FROM albums WHERE id = ?`, albumID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return id, nil
}

// cleanupOrphanCoverArt deletes a cover_arts blob nothing references
// anymore (v1 cleanupOrphanCoverArt).
func (s *Service) cleanupOrphanCoverArt(ctx context.Context, coverArtID string) error {
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM songs WHERE cover_art_id = ?
		 UNION ALL SELECT 1 FROM albums WHERE cover_art_id = ? LIMIT 1`,
		coverArtID, coverArtID).Scan(&one)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM cover_arts WHERE id = ?`, coverArtID)
	return err
}

// uploadSongCoverArt is POST /api/songs/{id}/cover-art.
func (s *Service) uploadSongCoverArt(ctx context.Context, id string, body []byte, mime string) (string, error) {
	var filePath string
	err := s.db.QueryRowContext(ctx,
		`SELECT file_path FROM songs WHERE id = ?`, id).Scan(&filePath)
	if errors.Is(err, sql.ErrNoRows) {
		return "", &stageError{status: 404, message: "Song not found"}
	}
	if err != nil {
		return "", err
	}

	coverArtID, err := library.EnsureCoverArt(ctx, s.db, mime, body)
	if err != nil {
		return "", err
	}
	old, err := s.songCoverArtID(ctx, id)
	if err != nil {
		return "", err
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE songs SET cover_art_id = ? WHERE id = ?`, coverArtID, id); err != nil {
		return "", err
	}
	if old != nil && *old != coverArtID {
		if err := s.cleanupOrphanCoverArt(ctx, *old); err != nil {
			return "", err
		}
	}
	// v1 queued a resync because it had rewritten the file; v2 only links
	// the blob, so nothing on disk changed — no resync.
	return coverArtID, nil
}

// deleteSongCoverArt is DELETE /api/songs/{id}/cover-art.
func (s *Service) deleteSongCoverArt(ctx context.Context, id string) error {
	var exists int
	if err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM songs WHERE id = ?`, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return &stageError{status: 404, message: "Song not found"}
	} else if err != nil {
		return err
	}
	old, err := s.songCoverArtID(ctx, id)
	if err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE songs SET cover_art_id = NULL WHERE id = ?`, id); err != nil {
		return err
	}
	if old != nil {
		return s.cleanupOrphanCoverArt(ctx, *old)
	}
	return nil
}

// uploadAlbumCoverArt is POST /api/albums/{id}/cover-art. v1 also embedded
// the art into every song file; v2 links the blob only (read-only doctrine).
func (s *Service) uploadAlbumCoverArt(ctx context.Context, id string, body []byte, mime string) (string, error) {
	var exists int
	if err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM albums WHERE id = ? AND active = 1`, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return "", &stageError{status: 404, message: "Album not found"}
	} else if err != nil {
		return "", err
	}

	coverArtID, err := library.EnsureCoverArt(ctx, s.db, mime, body)
	if err != nil {
		return "", err
	}
	old, err := s.albumCoverArtID(ctx, id)
	if err != nil {
		return "", err
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE albums SET cover_art_id = ? WHERE id = ?`, coverArtID, id); err != nil {
		return "", err
	}
	if old != nil && *old != coverArtID {
		if err := s.cleanupOrphanCoverArt(ctx, *old); err != nil {
			return "", err
		}
	}
	return coverArtID, nil
}

// deleteAlbumCoverArt is DELETE /api/albums/{id}/cover-art.
func (s *Service) deleteAlbumCoverArt(ctx context.Context, id string) error {
	var exists int
	if err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM albums WHERE id = ? AND active = 1`, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return &stageError{status: 404, message: "Album not found"}
	} else if err != nil {
		return err
	}
	old, err := s.albumCoverArtID(ctx, id)
	if err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE albums SET cover_art_id = NULL WHERE id = ?`, id); err != nil {
		return err
	}
	if old != nil {
		return s.cleanupOrphanCoverArt(ctx, *old)
	}
	return nil
}

// ---------------------------------------------------------------------------
// HTTP wiring
// ---------------------------------------------------------------------------

// Handler wires the tag-edit and cover-art endpoints to HTTP (admin-gated,
// v1 parity).
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

// NewHandler constructs the tags route handler.
func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers the tag-edit surface behind auth + admin.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth, h.mw.RequireAdmin)
		r.Put("/api/songs/{id}/tags", h.putSongTags)
		r.Put("/api/songs/tags", h.putSongsTags)
		r.Put("/api/albums/{id}/tags", h.putAlbumTags)
		r.Post("/api/songs/{id}/cover-art", h.postSongCoverArt)
		r.Delete("/api/songs/{id}/cover-art", h.deleteSongCoverArt)
		r.Post("/api/albums/{id}/cover-art", h.postAlbumCoverArt)
		r.Delete("/api/albums/{id}/cover-art", h.deleteAlbumCoverArt)
	})
}

func (h *Handler) putSongTags(w http.ResponseWriter, r *http.Request) {
	in, err := decodeTags(w, r)
	if err != nil {
		return
	}
	result, err := h.svc.applySongTags(r.Context(), chi.URLParam(r, "id"), in)
	if err != nil {
		writeStageError(w, r, err)
		return
	}
	out := map[string]any{"ok": true}
	if len(result.orphaned) > 0 {
		out["orphanedEntities"] = result.orphaned
	}
	httpserver.JSON(w, http.StatusOK, out)
}

// putSongsTags is v1's PUT /api/songs/tags: the same edit applied to a list
// of ids, applied sequentially; the first failure stops with that id.
func (h *Handler) putSongsTags(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs  []any          `json:"ids"`
		Tags map[string]any `json:"tags"`
	}
	if err := decodeJSONBody(w, r, &body); err != nil {
		return
	}
	if body.IDs == nil {
		httpserver.Error(w, http.StatusBadRequest, "ids must be an array of strings")
		return
	}
	ids := make([]string, 0, len(body.IDs))
	for _, id := range body.IDs {
		s, ok := id.(string)
		if !ok {
			httpserver.Error(w, http.StatusBadRequest, "ids must be an array of strings")
			return
		}
		ids = append(ids, s)
	}
	in, err := validateSongTags(body.Tags)
	if err != nil {
		var validation *ErrValidation
		if errors.As(err, &validation) {
			httpserver.Error(w, http.StatusBadRequest, validation.Message)
			return
		}
		httpserver.Error(w, http.StatusBadRequest, "Invalid tags")
		return
	}
	allOrphaned := []OrphanedEntity{}
	for _, id := range ids {
		result, err := h.svc.applySongTags(r.Context(), id, in)
		if err != nil {
			var stage *stageError
			if errors.As(err, &stage) {
				if stage.status >= http.StatusInternalServerError {
					slog.ErrorContext(r.Context(), "tags service error", "err", err)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(stage.status)
				json.NewEncoder(w).Encode(map[string]any{
					"error": stage.message, "failedId": id,
				})
				return
			}
			httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
			return
		}
		allOrphaned = append(allOrphaned, result.orphaned...)
	}
	out := map[string]any{"ok": true}
	if len(allOrphaned) > 0 {
		out["orphanedEntities"] = allOrphaned
	}
	httpserver.JSON(w, http.StatusOK, out)
}

func (h *Handler) putAlbumTags(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSONBody(w, r, &body); err != nil {
		return
	}
	// releaseType is album-level metadata, pulled out before the song-tag
	// validation like v1.
	var releaseType *string
	if v, present := body["releaseType"]; present {
		s, ok := v.(string)
		if !ok && v != nil {
			httpserver.Error(w, http.StatusBadRequest, "releaseType must be a string")
			return
		}
		if ok {
			releaseType = &s
		}
		delete(body, "releaseType")
	}
	in, err := validateSongTags(body)
	if err != nil {
		var validation *ErrValidation
		if errors.As(err, &validation) {
			httpserver.Error(w, http.StatusBadRequest, validation.Message)
			return
		}
		httpserver.Error(w, http.StatusBadRequest, "Invalid tags")
		return
	}
	updated, err := h.svc.applyAlbumTags(r.Context(), chi.URLParam(r, "id"), in, releaseType)
	if err != nil {
		writeStageError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"updated": updated})
}

func (h *Handler) postSongCoverArt(w http.ResponseWriter, r *http.Request) {
	body, mime, ok := readCoverArtBody(w, r)
	if !ok {
		return
	}
	id, err := h.svc.uploadSongCoverArt(r.Context(), chi.URLParam(r, "id"), body, mime)
	if err != nil {
		writeStageError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"coverArt": id})
}

func (h *Handler) deleteSongCoverArt(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.deleteSongCoverArt(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeStageError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) postAlbumCoverArt(w http.ResponseWriter, r *http.Request) {
	body, mime, ok := readCoverArtBody(w, r)
	if !ok {
		return
	}
	id, err := h.svc.uploadAlbumCoverArt(r.Context(), chi.URLParam(r, "id"), body, mime)
	if err != nil {
		writeStageError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"coverArt": id})
}

func (h *Handler) deleteAlbumCoverArt(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.deleteAlbumCoverArt(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeStageError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// decodeTags parses and validates a song-tag request body.
func decodeTags(w http.ResponseWriter, r *http.Request) (*SongTagsInput, error) {
	var body map[string]any
	if err := decodeJSONBody(w, r, &body); err != nil {
		return nil, err
	}
	in, err := validateSongTags(body)
	if err != nil {
		var validation *ErrValidation
		if errors.As(err, &validation) {
			httpserver.Error(w, http.StatusBadRequest, validation.Message)
			return nil, err
		}
		httpserver.Error(w, http.StatusBadRequest, "Invalid tags")
		return nil, err
	}
	return in, nil
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, v any) error {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return err
	}
	return nil
}

// writeStageError maps the apply-flow failures to v1's statuses; anything
// unexpected is a generic 500.
func writeStageError(w http.ResponseWriter, r *http.Request, err error) {
	var stage *stageError
	if errors.As(err, &stage) {
		if stage.status >= http.StatusInternalServerError {
			slog.ErrorContext(r.Context(), "tags service error", "err", err)
			httpserver.Error(w, stage.status, stage.message)
			return
		}
		httpserver.Error(w, stage.status, stage.message)
		return
	}
	var validation *ErrValidation
	if errors.As(err, &validation) {
		httpserver.Error(w, http.StatusBadRequest, validation.Message)
		return
	}
	slog.ErrorContext(r.Context(), "tags service error", "err", err)
	httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
}
