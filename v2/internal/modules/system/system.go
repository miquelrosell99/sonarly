// Package system provides liveness/readiness endpoints.
package system

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
)

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service { return &Service{db: db} }

func Register(r chi.Router, svc *Service) {
	r.Get("/health", svc.health)
	r.Get("/ready", svc.ready)
}

func (s *Service) health(w http.ResponseWriter, r *http.Request) {
	httpserver.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Service) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2_000_000_000)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		httpserver.Error(w, http.StatusServiceUnavailable, "database not ready")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
