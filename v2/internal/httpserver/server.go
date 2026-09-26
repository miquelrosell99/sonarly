// Package httpserver wires the chi router, middleware, and error contract.
package httpserver

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/miquelrosell99/sonarly/v2/internal/config"
)

type Server struct {
	router *chi.Mux
	log    *slog.Logger
}

func New(cfg config.Config, log *slog.Logger) *Server {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(apiTimeout(60 * time.Second))
	return &Server{router: r, log: log}
}

// apiTimeout bounds ordinary API routes with chi's Timeout middleware but
// leaves long-lived routes alone: the middleware derives a
// context.WithTimeout, whose deadline auto-cancels the request context and
// would SIGKILL a transcode (ffmpeg is bound to the request context), cut
// off a direct stream well before a long track finishes, or kill the SSE
// feed between heartbeats. Streaming routes carry their own bounds instead
// — the transcode semaphore plus disconnect-driven process kill, and the
// SSE loop's client-disconnect handling — so they need no wall-clock
// timeout.
func apiTimeout(timeout time.Duration) func(http.Handler) http.Handler {
	bounded := middleware.Timeout(timeout)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/stream/") || strings.HasPrefix(r.URL.Path, "/api/events") {
				next.ServeHTTP(w, r)
				return
			}
			bounded(next).ServeHTTP(w, r)
		})
	}
}

func (s *Server) Router() chi.Router { return s.router }

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}

// Error is the single error shape for the native API: {"error": "..."}.
func Error(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// JSON writes a JSON response.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
