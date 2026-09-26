package search

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler wires the search service to HTTP. Handlers parse and validate;
// the service enforces library scope on every category.
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers GET /api/search behind session auth (API keys included,
// like every other native route).
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/search", h.search)
	})
}

// search is GET /api/search?q=&type=&limit=&hideExplicit=. The envelope is
// always the full the retired server shape; unasked categories come back empty.
func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rawType := q.Get("type")
	var typ Category
	if rawType != "" {
		switch Category(rawType) {
		case CategorySongs, CategoryAlbums, CategoryArtists, CategoryPlaylists:
			typ = Category(rawType)
		default:
			httpserver.Error(w, http.StatusBadRequest, "Invalid query parameters")
			return
		}
	}
	categoryLimit := defaultPerType
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			httpserver.Error(w, http.StatusBadRequest, "Invalid query parameters")
			return
		}
		categoryLimit = min(n, maxCategoryResults)
	}
	hideExplicit, _ := strconv.ParseBool(q.Get("hideExplicit"))

	results, err := h.svc.Search(r.Context(), identity(r), q.Get("q"), typ, categoryLimit, hideExplicit)
	if err != nil {
		slog.ErrorContext(r.Context(), "search service error", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, results)
}

func identity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}
