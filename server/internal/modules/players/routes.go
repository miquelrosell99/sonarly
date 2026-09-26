package players

import (
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler wires the tracker to HTTP.
type Handler struct {
	tracker *Tracker
	db      *sql.DB
	mw      *auth.Middleware
}

func NewHandler(tracker *Tracker, db *sql.DB, mw *auth.Middleware) *Handler {
	return &Handler{tracker: tracker, db: db, mw: mw}
}

// Routes registers GET /api/players behind session auth. Like the retired server, any
// signed-in user sees the whole live set (it is a household dashboard, not
// a per-user view).
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/players", h.list)
	})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	players, err := h.tracker.Active(r.Context(), h.db)
	if err != nil {
		slog.ErrorContext(r.Context(), "players service error", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if players == nil {
		players = []PlayerInfo{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"players": players})
}
