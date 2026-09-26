package playback

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler wires the playback service to HTTP. Route handlers parse and
// validate, the service enforces liveness + library scope, and the route
// layer maps sentinel errors to the v2 error contract ({"error": "..."}).
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers the playback endpoints. The stream routes carry
// /api/stream/ (exempt from the global API timeout — see
// httpserver.apiTimeout) and sit behind AuthMiddleware WITHOUT RequireAuth:
// anonymous share-token viewers stream the linked playlist's songs, and the
// service consults the playlist policy only when the request is anonymous.
// Everything else requires a session.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware)
		r.Get("/api/stream/{id}", h.stream)
		r.Head("/api/stream/{id}", h.stream) // v1 parity: HEAD is answered explicitly
	})
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Post("/api/songs/{id}/scrobble", h.scrobble)
		r.Get("/api/bookmarks", h.listBookmarks)
		r.Put("/api/songs/{id}/bookmark", h.putBookmark)
		r.Delete("/api/songs/{id}/bookmark", h.deleteBookmark)
	})
}

func identity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var be *bodyError
	switch {
	case errors.Is(err, ErrNotFound):
		httpserver.Error(w, http.StatusNotFound, "Not found")
	case errors.Is(err, ErrUnauthorized):
		httpserver.Error(w, http.StatusUnauthorized, "Unauthorized")
	case errors.As(err, &be):
		httpserver.Error(w, http.StatusBadRequest, be.msg)
	default:
		slog.ErrorContext(r.Context(), "playback service error", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
	}
}

// bodyError is a request-body validation failure (400), as opposed to a
// genuine internal error (500).
type bodyError struct{ msg string }

func (e *bodyError) Error() string { return e.msg }

func invalidBody(msg string) error { return &bodyError{msg: msg} }

// stream is GET /api/stream/{id}: the native playback endpoint behind the
// same StreamingService the OpenSubsonic adapter (P9) will reuse.
//
// Query surface: maxBitRate (v1 parse semantics, clamped against the user's
// cap), download (direct + Content-Disposition, never transcodes), and the
// P6 share token (`?share=`): consulted only when the request is anonymous;
// a session identity wins. Anonymous with a valid token streams the linked
// playlist's songs without the library-scope check (v1 share semantics);
// anonymous with a missing/unknown token gets 401; a known token whose
// playlist does not contain the song gets 404.
func (h *Handler) stream(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var requested int
	var hasRequested bool
	if raw := q.Get("maxBitRate"); raw != "" {
		requested, hasRequested = ParseMaxBitRate(raw)
	}
	download, _ := strconv.ParseBool(q.Get("download"))

	if err := h.svc.Stream(w, r, identity(r), chi.URLParam(r, "id"), requested, hasRequested, download, q.Get("share")); err != nil {
		writeServiceError(w, r, err)
	}
}

// scrobble is POST /api/songs/{id}/scrobble (v1 /api/songs/:id/scrobble).
func (h *Handler) scrobble(w http.ResponseWriter, r *http.Request) {
	body, err := decodeScrobbleBody(r.Body)
	if err != nil {
		writeServiceError(w, r, invalidBody("request body must be valid JSON"))
		return
	}
	details, err := parseScrobbleBody(body)
	if err != nil {
		writeServiceError(w, r, invalidBody(err.Error()))
		return
	}
	if err := h.svc.Scrobble(r.Context(), identity(r), chi.URLParam(r, "id"), details); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// listBookmarks is GET /api/bookmarks: the caller's own, scoped, joined with
// song display info.
func (h *Handler) listBookmarks(w http.ResponseWriter, r *http.Request) {
	bookmarks, err := h.svc.ListBookmarks(r.Context(), identity(r))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"bookmarks": bookmarks})
}

type putBookmarkBody struct {
	Position *int    `json:"position"`
	Comment  *string `json:"comment"`
}

// putBookmark is PUT /api/songs/{id}/bookmark (upsert).
func (h *Handler) putBookmark(w http.ResponseWriter, r *http.Request) {
	var body putBookmarkBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeServiceError(w, r, invalidBody("request body must be a JSON object with a position"))
		return
	}
	if body.Position == nil || *body.Position < 0 {
		writeServiceError(w, r, invalidBody("position must be a non-negative integer"))
		return
	}
	if body.Comment != nil && len(*body.Comment) > maxBookmarkCommentLen {
		writeServiceError(w, r, invalidBody("comment must be at most "+strconv.Itoa(maxBookmarkCommentLen)+" characters"))
		return
	}
	if err := h.svc.PutBookmark(r.Context(), identity(r), chi.URLParam(r, "id"), *body.Position, body.Comment); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// deleteBookmark is DELETE /api/songs/{id}/bookmark.
func (h *Handler) deleteBookmark(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteBookmark(r.Context(), identity(r), chi.URLParam(r, "id")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
