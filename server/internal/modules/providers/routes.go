// HTTP wiring for the provider proxies (admin-gated, v1 parity). Error
// surfaces stay bounded: upstream statuses, URLs, and body fragments never
// reach the client — a failed proxy answers 502 with a generic message and
// the details stay in the server log.
package providers

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// slogError keeps upstream details in the server log only.
func slogError(ctx context.Context, msg string, err error) {
	slog.ErrorContext(ctx, msg, "err", err)
}

// mbSearchLimit is v1's default search limit.
const mbSearchLimit = 5

// Handler wires the provider endpoints to HTTP.
type Handler struct {
	mb     *MusicBrainzClient
	lrclib *LrcLibClient
	mw     *auth.Middleware
}

// NewHandler constructs the route handler.
func NewHandler(mb *MusicBrainzClient, lrclib *LrcLibClient, mw *auth.Middleware) *Handler {
	return &Handler{mb: mb, lrclib: lrclib, mw: mw}
}

// Routes registers GET /api/musicbrainz/search and GET /api/lrclib/search
// behind auth + admin.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth, h.mw.RequireAdmin)
		r.Get("/api/musicbrainz/search", h.searchMusicBrainz)
		r.Get("/api/lrclib/search", h.searchLrcLib)
	})
}

// searchMusicBrainz is v1's GET /api/musicbrainz/search: entityType
// song|album|artist, an optional exact mbid lookup falling through to the
// query search.
func (h *Handler) searchMusicBrainz(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	entityType := q.Get("entityType")
	if entityType != "song" && entityType != "album" && entityType != "artist" {
		httpserver.Error(w, http.StatusBadRequest, "entityType must be song, album, or artist")
		return
	}
	ctx := r.Context()

	matches := []Match{}
	mbid := strings.TrimSpace(q.Get("mbid"))
	if mbid != "" {
		var (
			match *Match
			err   error
		)
		switch entityType {
		case "song":
			match, err = h.mb.FetchRecording(ctx, mbid)
		case "album":
			match, err = h.mb.FetchRelease(ctx, mbid)
		default:
			match, err = h.mb.FetchArtist(ctx, mbid)
		}
		if err != nil {
			slogError(ctx, "musicbrainz fetch failed", err)
			httpserver.Error(w, http.StatusBadGateway, "MusicBrainz search failed")
			return
		}
		if match != nil {
			matches = append(matches, *match)
		}
	}

	if len(matches) == 0 {
		var (
			found []Match
			err   error
		)
		switch entityType {
		case "song":
			found, err = h.mb.SearchRecordings(ctx, q.Get("title"), q.Get("artist"), q.Get("album"), mbSearchLimit)
		case "album":
			found, err = h.mb.SearchReleases(ctx, q.Get("title"), q.Get("artist"), mbSearchLimit)
		default:
			found, err = h.mb.SearchArtists(ctx, q.Get("title"), mbSearchLimit)
		}
		if err != nil {
			slogError(ctx, "musicbrainz search failed", err)
			httpserver.Error(w, http.StatusBadGateway, "MusicBrainz search failed")
			return
		}
		matches = found
	}
	if matches == nil {
		matches = []Match{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"matches": matches})
}

// searchLrcLib is v1's GET /api/lrclib/search: title required, the rest
// optional; duration is a number when present.
func (h *Handler) searchLrcLib(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	title := strings.TrimSpace(q.Get("title"))
	if title == "" {
		httpserver.Error(w, http.StatusBadRequest, "title is required")
		return
	}
	query := LrcLibQuery{
		Title:  title,
		Artist: strings.TrimSpace(q.Get("artist")),
		Album:  strings.TrimSpace(q.Get("album")),
	}
	if raw := strings.TrimSpace(q.Get("duration")); raw != "" {
		if d, err := strconv.ParseFloat(raw, 64); err == nil {
			query.Duration = &d
		}
	}
	matches, err := h.lrclib.Search(r.Context(), query)
	if err != nil {
		slogError(r.Context(), "lrclib search failed", err)
		httpserver.Error(w, http.StatusBadGateway, "LRCLIB search failed")
		return
	}
	if matches == nil {
		matches = []LrcLibMatch{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"matches": matches})
}
