package suggestions_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/suggestions"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type server struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
}

func newServer(t *testing.T) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	r := chi.NewRouter()
	suggestions.NewHandler(suggestions.NewService(database), mw).Routes(r)
	s := &server{db: database, store: store, router: r}
	s.seed(t)
	return s
}

func (s *server) seed(t *testing.T) {
	t.Helper()
	exec := func(q string, args ...any) {
		if _, err := s.db.Exec(q, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	exec(`INSERT INTO artists (id, name, active) VALUES ('ar-1', 'Alice Coltrane', 1), ('ar-2', 'alice in chains', 1), ('ar-3', 'Bob Dylan', 1), ('ar-4', 'Ghost', 0)`)
	exec(`INSERT INTO albums (id, name, active, artist_name, release_type) VALUES
		('al-1', 'Journey in Satchidananda', 1, 'Alice Coltrane', 'Album'),
		('al-2', 'Dirt', 1, 'alice in chains', 'Album'),
		('al-3', 'MTV Unplugged', 1, 'alice in chains', 'Live')`)
	// Genre tree: Rock > Indie (child), Jazz (root).
	exec(`INSERT INTO genres (id, name, parent_id, active) VALUES
		('g-rock', 'Rock', NULL, 1), ('g-indie', 'Indie', 'g-rock', 1), ('g-jazz', 'Jazz', NULL, 1)`)
}

func (s *server) do(t *testing.T, method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func (s *server) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
	t.Helper()
	if _, err := s.db.Exec(
		`INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, 'x', ?)
		 ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin`,
		userID, username, boolToInt(isAdmin)); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	sid := auth.NewSID()
	if err := s.store.Create(context.Background(), sid, auth.Session{
		UserID: userID, Username: username, IsAdmin: isAdmin,
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, testSecret, false, sid)
	return rec.Result().Cookies()[0]
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

func suggestionsOf(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	var list []string
	for _, item := range decode(t, rec)["suggestions"].([]any) {
		list = append(list, item.(string))
	}
	return list
}

func TestSuggestionsAuthz(t *testing.T) {
	s := newServer(t)
	if rec := s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=a", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: want 401, got %d", rec.Code)
	}
	user := s.session(t, "u-1", "user", false)
	if rec := s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=a", user); rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin: want 403, got %d", rec.Code)
	}
}

func TestSuggestionsFieldWhitelist(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	rec := s.do(t, http.MethodGet, "/api/suggestions?field=composer&q=a", admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unsupported field: want 400, got %d", rec.Code)
	}
	if got := decode(t, rec)["error"]; got != "Unsupported suggestion field: composer" {
		t.Fatalf("error = %v", got)
	}
	// field missing entirely.
	rec = s.do(t, http.MethodGet, "/api/suggestions?q=a", admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing field: want 400, got %d", rec.Code)
	}
}
func TestSuggestionsArtistAlbumNocase(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	// NOCASE contains-match, ordered by name: both "alice" rows match, the
	// inactive Ghost does not appear.
	rec := s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=ALICE", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	got := suggestionsOf(t, rec)
	want := []string{"Alice Coltrane", "alice in chains"}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("artists = %v, want %v", got, want)
	}

	// Album field.
	rec = s.do(t, http.MethodGet, "/api/suggestions?field=album&q=dirt", admin)
	if got := suggestionsOf(t, rec); len(got) != 1 || got[0] != "Dirt" {
		t.Fatalf("albums = %v", got)
	}

	// albumArtist over the albums' artist_name column.
	rec = s.do(t, http.MethodGet, "/api/suggestions?field=albumArtist&q=alice", admin)
	if got := suggestionsOf(t, rec); len(got) != 2 {
		t.Fatalf("albumArtists = %v", got)
	}
}

func TestSuggestionsLikeEscaping(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	// A literal % in the query must not act as a wildcard.
	rec := s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=%25", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if got := suggestionsOf(t, rec); len(got) != 0 {
		t.Fatalf("%% matched %v", got)
	}
	// A literal underscore must not act as a single-char wildcard.
	rec = s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=_", admin)
	if got := suggestionsOf(t, rec); len(got) != 0 {
		t.Fatalf("_ matched %v", got)
	}
}

func TestSuggestionsLimitClamp(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	// Default limit 20; clamped minimum 1.
	rec := s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=a&limit=1", admin)
	if got := suggestionsOf(t, rec); len(got) != 1 {
		t.Fatalf("limit=1 gave %d suggestions", len(got))
	}
	// Garbage limit falls back to 20 (all three alice/bob rows match "a"? no — 'a' matches Alice x2 + alice in chains = 3).
	rec = s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=a&limit=xyz", admin)
	if got := suggestionsOf(t, rec); len(got) != 3 {
		t.Fatalf("default limit gave %v", got)
	}
	// Zero limit falls back too (the old Number(limit) || 20).
	rec = s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=a&limit=0", admin)
	if got := suggestionsOf(t, rec); len(got) != 3 {
		t.Fatalf("limit=0 gave %v", got)
	}
	// Above the cap clamps to 50 — request 500 and confirm no error.
	if rec := s.do(t, http.MethodGet, "/api/suggestions?field=artist&q=a&limit=500", admin); rec.Code != http.StatusOK {
		t.Fatalf("limit=500: want 200, got %d", rec.Code)
	}
}

func TestSuggestionsReleaseType(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	// The canonical seeds merge with stored values, de-duplicated
	// case-insensitively: stored "Album" fills the seed slot; "Live" is
	// stored only.
	rec := s.do(t, http.MethodGet, "/api/suggestions?field=releaseType&q=li", admin)
	got := suggestionsOf(t, rec)
	if len(got) != 1 || got[0] != "Live" {
		t.Fatalf("releaseType li = %v", got)
	}

	rec = s.do(t, http.MethodGet, "/api/suggestions?field=releaseType&q=a", admin)
	got = suggestionsOf(t, rec)
	// Seeds containing "a": Album, Compilation, Soundtrack. The stored
	// values are filtered by the same query — "Album" matches and dedups
	// against the seed; "Live" does not contain "a" (see the li case).
	seen := map[string]bool{}
	for _, g := range got {
		seen[g] = true
	}
	for _, want := range []string{"Album", "Compilation", "Soundtrack"} {
		if !seen[want] {
			t.Fatalf("releaseType a = %v, missing %s", got, want)
		}
	}
	if len(got) != 3 {
		t.Fatalf("releaseType a = %v, want exactly 3", got)
	}
}

func TestSuggestionsGenrePaths(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	rec := s.do(t, http.MethodGet, "/api/suggestions?field=genre&q=rock", admin)
	got := suggestionsOf(t, rec)
	// Every genre's full path matches: the root "Rock" and "Rock > Indie".
	if len(got) != 2 || got[0] != "Rock" || got[1] != "Rock > Indie" {
		t.Fatalf("genre rock = %v", got)
	}

	rec = s.do(t, http.MethodGet, "/api/suggestions?field=genre&q=indie", admin)
	if got := suggestionsOf(t, rec); len(got) != 1 || got[0] != "Rock > Indie" {
		t.Fatalf("genre indie = %v", got)
	}
}
