package statistics

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// Handler wires the statistics service to HTTP. Route handlers parse and
// validate; admin routes sit behind RequireAdmin (the flag re-read from the
// database, like the rest of v2). Service errors map onto the typed
// contract: ErrUserNotFound is a 404, everything else a logged 500 with a
// generic message — never a raw driver error (v1 lesson).
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers the statistics endpoints behind session auth.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/statistics/me", h.me)
		r.Get("/api/statistics/me/monthly-grouped", h.myMonthlyGrouped)
		r.Group(func(r chi.Router) {
			r.Use(h.mw.RequireAdmin)
			r.Get("/api/statistics/overall", h.overall)
			r.Get("/api/statistics/users/{id}", h.user)
			r.Get("/api/statistics/users/{id}/monthly-grouped", h.userMonthlyGrouped)
		})
	})
}

// parseRange mirrors v1: an absent or unrecognized range falls back to
// "all" rather than failing the request.
func parseRange(raw string) TimeRange {
	switch TimeRange(raw) {
	case Range7d, Range30d, Range90d, Range1y:
		return TimeRange(raw)
	default:
		return RangeAll
	}
}

// parseGroupBy mirrors v1's zod enum: an unrecognized groupBy is a 400.
func parseGroupBy(raw string) (GroupBy, bool) {
	switch GroupBy(raw) {
	case GroupByArtist, GroupByGenre, GroupByYear, GroupByRating, GroupByFavorite:
		return GroupBy(raw), true
	default:
		return "", false
	}
}

func identity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrUserNotFound) {
		httpserver.Error(w, http.StatusNotFound, "Not found")
		return
	}
	slog.ErrorContext(r.Context(), "statistics service error", "err", err)
	httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	stats, err := h.svc.UserStatistics(r.Context(), identity(r).UserID, parseRange(r.URL.Query().Get("range")))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, stats)
}

func (h *Handler) overall(w http.ResponseWriter, r *http.Request) {
	stats, err := h.svc.OverallStatistics(r.Context(), parseRange(r.URL.Query().Get("range")))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, stats)
}

func (h *Handler) user(w http.ResponseWriter, r *http.Request) {
	stats, err := h.svc.UserStatistics(r.Context(), chi.URLParam(r, "id"), parseRange(r.URL.Query().Get("range")))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, stats)
}

func (h *Handler) myMonthlyGrouped(w http.ResponseWriter, r *http.Request) {
	h.monthlyGrouped(w, r, identity(r).UserID)
}

func (h *Handler) userMonthlyGrouped(w http.ResponseWriter, r *http.Request) {
	h.monthlyGrouped(w, r, chi.URLParam(r, "id"))
}

func (h *Handler) monthlyGrouped(w http.ResponseWriter, r *http.Request, userID string) {
	groupBy, ok := parseGroupBy(r.URL.Query().Get("groupBy"))
	if !ok {
		httpserver.Error(w, http.StatusBadRequest, "Invalid query parameters")
		return
	}
	data, err := h.svc.MonthlyGrouped(r.Context(), userID, parseRange(r.URL.Query().Get("range")), groupBy)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if data == nil {
		data = []MonthlyGroupedItem{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"data": data})
}
