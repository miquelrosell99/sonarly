package autodj

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler wires the auto-dj service to HTTP. Both the legacy GET variant
// (exclusions as a comma-separated query string) and the POST variant
// (exclusions in the body) answer /api/playback/auto-dj, like the retired server.
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers the auto-dj endpoints behind session auth.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/playback/auto-dj", h.get)
		r.Post("/api/playback/auto-dj", h.post)
	})
}

type request struct {
	CurrentSongID string
	Mode          Mode
	Count         int
	ExcludeIDs    []string
}

// get parses the legacy query-string variant: excludeIds arrives as a
// comma-separated list (wire parity, capped).
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	mode, ok := parseMode(q.Get("mode"))
	if !ok {
		httpserver.Error(w, http.StatusBadRequest, "Invalid query parameters")
		return
	}
	count, ok := parseCount(q.Get("count"))
	if !ok {
		httpserver.Error(w, http.StatusBadRequest, "Invalid query parameters")
		return
	}
	var exclude []string
	if raw := q.Get("excludeIds"); raw != "" {
		for _, id := range strings.Split(raw, ",") {
			if id = strings.TrimSpace(id); id != "" {
				exclude = append(exclude, id)
			}
		}
		if len(exclude) > maxExcludeIDs {
			exclude = exclude[:maxExcludeIDs]
		}
	}
	h.respond(w, r, request{
		CurrentSongID: q.Get("currentSongId"),
		Mode:          mode,
		Count:         count,
		ExcludeIDs:    exclude,
	})
}

// post parses the body variant: exclusions arrive as a JSON array (old caps
// the array at MAX_EXCLUDE_IDS; an over-long array is a 400, like the old zod
// validation).
func (h *Handler) post(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentSongID *string  `json:"currentSongId"`
		Mode          string   `json:"mode"`
		Count         *int     `json:"count"`
		ExcludeIDs    []string `json:"excludeIds"`
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&body); err != nil {
		if errors.Is(err, io.EOF) {
			httpserver.Error(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		httpserver.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	mode, ok := parseMode(body.Mode)
	if !ok {
		httpserver.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	count := 10
	if body.Count != nil {
		if *body.Count < 1 || *body.Count > 50 {
			httpserver.Error(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		count = *body.Count
	}
	if len(body.ExcludeIDs) > maxExcludeIDs {
		httpserver.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	currentSongID := ""
	if body.CurrentSongID != nil {
		currentSongID = *body.CurrentSongID
	}
	h.respond(w, r, request{
		CurrentSongID: currentSongID,
		Mode:          mode,
		Count:         count,
		ExcludeIDs:    body.ExcludeIDs,
	})
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request, req request) {
	songs, err := h.svc.Candidates(r.Context(), identity(r), req.CurrentSongID, req.Mode, req.Count, req.ExcludeIDs)
	if err != nil {
		if errors.Is(err, ErrGeneration) {
			// Typed generation failure: 502 with a generic message (the Go server's
			// deviation from the old silent empty 200, documented in the
			// package doc). The underlying error is logged server-side.
			slog.ErrorContext(r.Context(), "auto-dj generation failed", "err", err)
			httpserver.Error(w, http.StatusBadGateway, "Auto-DJ generation failed")
			return
		}
		slog.ErrorContext(r.Context(), "auto-dj service error", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"songs": songs})
}

func parseMode(raw string) (Mode, bool) {
	switch Mode(raw) {
	case ModeSimilar, ModeRandom, ModeSmart:
		return Mode(raw), true
	default:
		return "", false
	}
}

// parseCount mirrors the old zod schema: default 10, integer in [1, 50];
// anything else is a 400.
func parseCount(raw string) (int, bool) {
	if raw == "" {
		return 10, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 50 {
		return 0, false
	}
	return n, true
}

func identity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}
