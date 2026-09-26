package events

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler serves GET /api/events as a server-sent-event stream. Session
// auth only (see the package doc); the response streams until the client
// disconnects, the write side fails, or the server shuts down.
type Handler struct {
	broker *Broker
	mw     *auth.Middleware
	// heartbeat drives the keepalive comment interval; the default is the
	// package constant, tests shorten it.
	heartbeat time.Duration
}

func NewHandler(broker *Broker, mw *auth.Middleware) *Handler {
	return &Handler{broker: broker, mw: mw, heartbeat: heartbeatInterval}
}

// Routes registers the stream behind session auth.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware)
		r.Get("/api/events", h.stream)
	})
}

// stream answers a text/event-stream response. The global API timeout
// exempts /api/events in httpserver (SSE is long-lived by design, like
// /api/stream/).
func (h *Handler) stream(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mw.SessionIdentity(r); !ok {
		httpserver.Error(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}

	header := w.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no") // disable proxy response buffering
	w.WriteHeader(http.StatusOK)

	// the retired server sent a connected event on subscribe; the web client uses it as the
	// readiness signal.
	if !writeEvent(w, flusher, Event{Type: "connected"}) {
		return
	}

	events, unsubscribe := h.broker.Subscribe()
	defer unsubscribe()

	heartbeat := time.NewTicker(h.heartbeat)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			// Client disconnected (or the server is shutting down):
			// cleanup runs through the deferred unsubscribe.
			return
		case ev := <-events:
			if !writeEvent(w, flusher, ev) {
				return
			}
		case <-heartbeat.C:
			// Heartbeat comments keep proxies and browsers from closing
			// an otherwise idle stream.
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// writeEvent frames one event as SSE and flushes it. Any write or flush
// failure reports false so the caller tears the stream down (old lesson: a
// failed write must unsubscribe, not spin).
func writeEvent(w http.ResponseWriter, flusher http.Flusher, ev Event) bool {
	data, err := json.Marshal(ev)
	if err != nil {
		return false
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, data); err != nil {
		return false
	}
	flusher.Flush()
	return true
}
