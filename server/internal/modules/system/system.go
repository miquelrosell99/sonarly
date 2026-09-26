// Package system provides liveness/readiness endpoints.
package system

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
)

type Service struct {
	db  *sql.DB
	log *slog.Logger
}

func NewService(db *sql.DB, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, log: log}
}

func Register(r chi.Router, svc *Service) {
	r.Get("/health", svc.health)
	// Alias kept for the container HEALTHCHECK and wire parity: the retired server image
	// (and its compose healthcheck) probes /healthz.
	r.Get("/healthz", svc.health)
	r.Get("/ready", svc.ready)
	// Client-side crash reporting: the web ErrorBoundary, window.onerror and
	// unhandledrejection POST here so production render crashes are
	// diagnosable from server logs. Anonymous (like /api/avatars), tiny,
	// fire-and-forget.
	r.Post("/api/client-errors", svc.clientError)
}

type clientErrorReport struct {
	Message string `json:"message"`
	Stack   string `json:"stack"`
	Route   string `json:"route"`
}

func (s *Service) clientError(w http.ResponseWriter, r *http.Request) {
	var report clientErrorReport
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&report); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "invalid report")
		return
	}
	s.log.Warn("client error report",
		"route", report.Route,
		"message", report.Message,
		"stack", report.Stack,
	)
	httpserver.JSON(w, http.StatusOK, map[string]bool{"ok": true})
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
