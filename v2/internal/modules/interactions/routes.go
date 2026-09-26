package interactions

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// Handler wires the interactions service to HTTP. Both endpoints are behind
// session auth (RequireAuth) like every other native write.
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers POST /api/favorites and POST /api/ratings.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Post("/api/favorites", h.setFavorite)
		r.Post("/api/ratings", h.setRating)
	})
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.Error(w, http.StatusBadRequest, err.Error())
	default:
		slog.ErrorContext(r.Context(), "interactions service error", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
	}
}

// favoriteBody is POST /api/favorites: exactly one entity id, starred
// optional (absent = favorite, the endpoint's purpose).
type favoriteBody struct {
	SongID   string `json:"songId"`
	AlbumID  string `json:"albumId"`
	ArtistID string `json:"artistId"`
	Starred  *bool  `json:"starred"`
}

func (h *Handler) setFavorite(w http.ResponseWriter, r *http.Request) {
	var body favoriteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	starred := true
	if body.Starred != nil {
		starred = *body.Starred
	}
	if err := h.svc.SetFavorite(r.Context(), identity(r), body.SongID, body.AlbumID, body.ArtistID, starred); err != nil {
		h.writeError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ratingBody is POST /api/ratings: exactly one entity id, rating a number
// in 0.5 steps 0..5 or null/absent (clear the rating).
type ratingBody struct {
	SongID   string   `json:"songId"`
	AlbumID  string   `json:"albumId"`
	ArtistID string   `json:"artistId"`
	Rating   *float64 `json:"rating"`
}

func (h *Handler) setRating(w http.ResponseWriter, r *http.Request) {
	var body ratingBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if err := h.svc.SetRating(r.Context(), identity(r), body.SongID, body.AlbumID, body.ArtistID, body.Rating); err != nil {
		h.writeError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func identity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}
