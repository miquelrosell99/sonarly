package home

import (
	"crypto/rand"
	"encoding/binary"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// Handler wires the home service to HTTP.
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers GET /api/home behind session auth.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/home", h.home)
	})
}

// home is GET /api/home. Query surface: libraryId (v1 parity), hideExplicit
// (v2 catalog convention), limit (random section only, clamped to
// [1, maxRandomLimit], default homeLimit).
func (h *Handler) home(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	randomLimit := homeLimit
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			httpserver.Error(w, http.StatusBadRequest, "Invalid query parameters")
			return
		}
		randomLimit = min(n, maxRandomLimit)
	}
	hideExplicit, _ := strconv.ParseBool(q.Get("hideExplicit"))

	resp, err := h.svc.Home(r.Context(), identity(r), q.Get("libraryId"), hideExplicit, randomLimit, drawSeed())
	if err != nil {
		slog.ErrorContext(r.Context(), "home service error", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, resp)
}

// drawSeed mints the per-request seed for the random section.
func drawSeed() int64 {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return 0
	}
	return int64(binary.LittleEndian.Uint64(buf[:]))
}

func identity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}
