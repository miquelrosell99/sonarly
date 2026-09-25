package opensubsonic

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// Handler wires the OpenSubsonic adapter to HTTP: the /rest group carries
// the session middleware (cookie + header-apiKey identity) first, then the
// Subsonic auth hook, then the system endpoints. Browsing/retrieval groups
// register inside Routes as P9 lands them.
type Handler struct {
	db   *sql.DB
	mw   *auth.Middleware
	auth *Auth
}

func NewHandler(db *sql.DB, mw *auth.Middleware, sessionSecret string) *Handler {
	return &Handler{db: db, mw: mw, auth: NewAuth(db, sessionSecret)}
}

// Routes registers the /rest group. Unknown /rest/* paths answer an
// enveloped error 0 "not implemented" instead of v1's bare Fastify 404, so
// Subsonic clients get a parseable envelope during development (E5).
func (h *Handler) Routes(r chi.Router) {
	r.Route("/rest", func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, h.auth.Hook)
		r.Get("/ping.view", h.ping)
		r.Get("/getLicense.view", h.getLicense)
		r.Get("/getOpenSubsonicExtensions.view", h.getOpenSubsonicExtensions)
		r.Get("/getUser.view", h.getUser)
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			Error(w, r, CodeNotImplemented, "Not implemented")
		})
	})
}
