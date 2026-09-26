// Package suggestions is the admin field-whitelist autocomplete (P9c) —
// v1's features/suggestions/routes.ts ported query for query: LIKE
// contains-match with %/_ escaped, COLLATE NOCASE, per-field statements,
// the releaseType seed merge, genre full paths, and the 1–50 limit clamp.
package suggestions

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// allowedFields is v1's ALLOWED_FIELDS.
var allowedFields = map[string]bool{
	"artist": true, "album": true, "genre": true, "albumArtist": true, "releaseType": true,
}

const maxLimit = 50

// releaseTypeSeeds is v1's RELEASE_TYPE_SEEDS: canonical casing first, the
// stored values fill in anything else.
var releaseTypeSeeds = []string{"Album", "EP", "Single", "Compilation", "Live", "Soundtrack", "Remix"}

// Service runs the suggestion queries.
type Service struct {
	db *sql.DB
}

// NewService constructs the service.
func NewService(db *sql.DB) *Service { return &Service{db: db} }

// escapeLike ports v1's LIKE escaping: % and _ get a backslash escape, and
// the caller's ESCAPE '\' clause interprets them.
func escapeLike(query string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return `%` + replacer.Replace(query) + `%`
}

// Suggest ports getSuggestions. limit is already clamped by the handler.
func (s *Service) Suggest(ctx context.Context, field, query string, limit int) ([]string, error) {
	like := escapeLike(query)
	switch field {
	case "artist":
		return s.queryNames(ctx,
			`SELECT name FROM artists WHERE active = 1 AND name LIKE ? COLLATE NOCASE ESCAPE '\' ORDER BY name LIMIT ?`,
			like, limit)
	case "album":
		return s.queryNames(ctx,
			`SELECT name FROM albums WHERE active = 1 AND name LIKE ? COLLATE NOCASE ESCAPE '\' ORDER BY name LIMIT ?`,
			like, limit)
	case "albumArtist":
		return s.queryNames(ctx,
			`SELECT DISTINCT artist_name AS name FROM albums WHERE active = 1 AND artist_name IS NOT NULL AND artist_name LIKE ? COLLATE NOCASE ESCAPE '\' ORDER BY artist_name LIMIT ?`,
			like, limit)
	case "releaseType":
		return s.releaseTypes(ctx, query, limit)
	default: // genre
		return s.genrePaths(ctx, query, limit)
	}
}

func (s *Service) queryNames(ctx context.Context, statement, like string, limit int) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, statement, like, limit)
	if err != nil {
		return nil, fmt.Errorf("suggest: %w", err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("suggest: %w", err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("suggest: %w", err)
	}
	return names, nil
}

// releaseTypes merges the canonical seeds (matched case-insensitively
// against the query) with stored release_type values, de-duplicated by
// lowercase (v1).
func (s *Service) releaseTypes(ctx context.Context, query string, limit int) ([]string, error) {
	stored, err := s.queryNames(ctx,
		`SELECT DISTINCT release_type AS name FROM albums WHERE release_type IS NOT NULL AND release_type <> '' AND release_type LIKE ? COLLATE NOCASE ESCAPE '\' ORDER BY release_type LIMIT ?`,
		escapeLike(query), limit)
	if err != nil {
		return nil, err
	}
	lowerQuery := strings.ToLower(query)
	merged := []string{}
	for _, seed := range releaseTypeSeeds {
		if strings.Contains(strings.ToLower(seed), lowerQuery) {
			merged = append(merged, seed)
		}
	}
	for _, name := range stored {
		exists := false
		for _, existing := range merged {
			if strings.EqualFold(existing, name) {
				exists = true
				break
			}
		}
		if !exists {
			merged = append(merged, name)
		}
	}
	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged, nil
}

// genrePaths returns full genre paths ("Rock > Indie") filtered
// case-insensitively and sorted (v1's buildGenrePaths-based branch).
func (s *Service) genrePaths(ctx context.Context, query string, limit int) ([]string, error) {
	type genreRow struct {
		id       string
		name     string
		parentID *string
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, parent_id FROM genres WHERE active = 1`)
	if err != nil {
		return nil, fmt.Errorf("suggest genres: %w", err)
	}
	var all []genreRow
	for rows.Next() {
		var g genreRow
		if err := rows.Scan(&g.id, &g.name, &g.parentID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("suggest genres: %w", err)
		}
		all = append(all, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("suggest genres: %w", err)
	}
	byID := make(map[string]genreRow, len(all))
	for _, g := range all {
		byID[g.id] = g
	}
	lowerQuery := strings.ToLower(query)
	var paths []string
	for _, g := range all {
		var parts []string
		visited := map[string]bool{}
		for cur := &g; cur != nil && !visited[cur.id]; {
			visited[cur.id] = true
			parts = append([]string{cur.name}, parts...)
			if cur.parentID == nil {
				break
			}
			parent, ok := byID[*cur.parentID]
			if !ok {
				break
			}
			cur = &parent
		}
		path := strings.Join(parts, " > ")
		if strings.Contains(strings.ToLower(path), lowerQuery) {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	if len(paths) > limit {
		paths = paths[:limit]
	}
	return paths, nil
}

// Handler wires the suggestion endpoint to HTTP (admin-gated, v1 parity).
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

// NewHandler constructs the route handler.
func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers GET /api/suggestions behind auth + admin.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth, h.mw.RequireAdmin)
		r.Get("/api/suggestions", h.get)
	})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	field := q.Get("field")
	if !allowedFields[field] {
		httpserver.Error(w, http.StatusBadRequest, "Unsupported suggestion field: "+field)
		return
	}
	limit := clampLimit(q.Get("limit"))
	suggestions, err := h.svc.Suggest(r.Context(), field, strings.TrimSpace(q.Get("q")), limit)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if suggestions == nil {
		suggestions = []string{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"suggestions": suggestions})
}

// clampLimit ports v1's Math.min(Math.max(Number(limit) || 20, 1), 50):
// unparsable or zero limits fall back to 20; the result is clamped to
// [1, 50] and truncated like SQLite's LIMIT would.
func clampLimit(raw string) int {
	limit := 20.0
	if raw != "" {
		if n, err := strconv.ParseFloat(raw, 64); err == nil && n != 0 {
			limit = n
		}
	}
	if limit < 1 {
		return 1
	}
	if limit > maxLimit {
		return maxLimit
	}
	return int(limit)
}
