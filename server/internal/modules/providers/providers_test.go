// Provider proxy tests against httptest fakes: query building, response
// mapping, the mbid fall-through, bounded 502s, the LRCLIB retry, and the
// MusicBrainz rate-limit spacing.
package providers_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/providers"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type server struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
}

// newServer wires the handler against fake clients pointing at fakeBase.
func newServer(t *testing.T, fakeBase string, mbRateLimit time.Duration) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	r := chi.NewRouter()
	mb := providers.NewMusicBrainzClient(
		providers.WithMBBaseURL(fakeBase+"/ws/2"),
		providers.WithMBHTTPClient(http.DefaultClient),
		providers.WithMBRateLimit(mbRateLimit),
	)
	lrclib := providers.NewLrcLibClient(
		providers.WithLrcLibBaseURL(fakeBase+"/api"),
		providers.WithLrcLibHTTPClient(http.DefaultClient),
		providers.WithLrcLibSleep(func(time.Duration) {}),
	)
	providers.NewHandler(mb, lrclib, mw).Routes(r)
	return &server{db: database, store: store, router: r}
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

// musicBrainzFixture is the recording search payload the fake serves.
const musicBrainzFixture = `{
  "recordings": [{
    "id": "rec-1",
    "title": "Fix You",
    "disambiguation": "album version",
    "artist-credit": [{"name": "Coldplay", "artist": {"id": "ar-coldplay", "name": "Coldplay"}}],
    "releases": [{
      "id": "rel-1",
      "title": "X&Y",
      "date": "2005-06-06",
      "artist-credit": [{"name": "Coldplay"}],
      "release-group": {"id": "rg-1", "primary-type": "Album"},
      "tags": [{"name": "Rock", "score": 100}]
    }],
    "tags": [{"name": "Alternative Rock", "count": 10}]
  }]
}`

func TestMusicBrainzSearchMapsRecording(t *testing.T) {
	var gotQuery string
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query().Get("query")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, musicBrainzFixture)
	}))
	defer fake.Close()

	s := newServer(t, fake.URL, 0)
	admin := s.session(t, "u-admin", "admin", true)

	rec := s.do(t, http.MethodGet,
		"/api/musicbrainz/search?entityType=song&title=Fix%20You&artist=Coldplay,%20Rihanna&album=X%26Y", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	matches := decode(t, rec)["matches"].([]any)
	if len(matches) != 1 {
		t.Fatalf("matches = %d", len(matches))
	}
	m := matches[0].(map[string]any)
	if m["id"] != "rec-1" || m["title"] != "Fix You" || m["album"] != "X&Y" || m["year"] != float64(2005) {
		t.Fatalf("match = %v", m)
	}
	if m["artist"] != "Coldplay" {
		t.Fatalf("artist = %v", m["artist"])
	}
	if m["coverArt"] != "https://coverartarchive.org/release/rel-1/front" {
		t.Fatalf("coverArt = %v", m["coverArt"])
	}
	if genres := m["genres"].([]any); len(genres) != 1 || genres[0] != "Alternative Rock" {
		t.Fatalf("genres = %v (recording tags win)", genres)
	}

	// The Lucene query: quoted title (contains a space), first-artist split
	// on the comma. & is NOT in the old Lucene escape set, so X&Y stays bare.
	want := `recording:"Fix You" AND artist:Coldplay AND release:X&Y`
	if gotQuery != want {
		t.Fatalf("query = %q, want %q", gotQuery, want)
	}
}

func TestMusicBrainzMbidFetchAndFallback(t *testing.T) {
	var hits int32
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/ws/2/recording/mbid-1" {
			fmt.Fprint(w, `{"id":"mbid-1","title":"Direct Hit","artist-credit":[{"name":"The Artist"}],"releases":[{"id":"rel-9","title":"The Album","date":"1999-01-01"}]}`)
			return
		}
		// Unknown mbid → 404 → the route falls through to the search.
		if r.URL.Path == "/ws/2/recording/missing-1" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fmt.Fprint(w, musicBrainzFixture)
	}))
	defer fake.Close()

	s := newServer(t, fake.URL, 0)
	admin := s.session(t, "u-admin", "admin", true)

	rec := s.do(t, http.MethodGet, "/api/musicbrainz/search?entityType=song&mbid=mbid-1", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("mbid fetch: want 200, got %d", rec.Code)
	}
	matches := decode(t, rec)["matches"].([]any)
	if len(matches) != 1 || matches[0].(map[string]any)["title"] != "Direct Hit" {
		t.Fatalf("matches = %v", matches)
	}

	rec = s.do(t, http.MethodGet, "/api/musicbrainz/search?entityType=song&mbid=missing-1&title=Fix%20You", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("fallback: want 200, got %d", rec.Code)
	}
	matches = decode(t, rec)["matches"].([]any)
	if len(matches) != 1 || matches[0].(map[string]any)["title"] != "Fix You" {
		t.Fatalf("fallback matches = %v", matches)
	}
}

func TestMusicBrainzBoundedErrors(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `<html>upstream exploded with secret internals</html>`)
	}))
	defer fake.Close()

	s := newServer(t, fake.URL, 0)
	admin := s.session(t, "u-admin", "admin", true)

	rec := s.do(t, http.MethodGet, "/api/musicbrainz/search?entityType=song&title=x", admin)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", rec.Code)
	}
	body := rec.Body.String()
	if body != `{"error":"MusicBrainz search failed"}`+"\n" {
		t.Fatalf("body = %q (upstream details must not leak)", body)
	}

	if rec := s.do(t, http.MethodGet, "/api/musicbrainz/search?entityType=bogus&title=x", admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad entityType: want 400, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/musicbrainz/search?title=x", admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing entityType: want 400, got %d", rec.Code)
	}
}

func TestMusicBrainzRateLimitSpacing(t *testing.T) {
	var mu []time.Time
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu = append(mu, time.Now())
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"recordings":[]}`)
	}))
	defer fake.Close()

	const spacing = 50 * time.Millisecond
	s := newServer(t, fake.URL, spacing)
	admin := s.session(t, "u-admin", "admin", true)

	for i := 0; i < 3; i++ {
		rec := s.do(t, http.MethodGet,
			fmt.Sprintf("/api/musicbrainz/search?entityType=song&title=t%d", i), admin)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: want 200, got %d", i, rec.Code)
		}
	}
	if len(mu) != 3 {
		t.Fatalf("fake saw %d requests", len(mu))
	}
	for i := 1; i < len(mu); i++ {
		if gap := mu[i].Sub(mu[i-1]); gap < spacing {
			t.Fatalf("request %d came %s after the previous (min %s)", i, gap, spacing)
		}
	}
}

func TestLrcLibSearch(t *testing.T) {
	var gotQuery url.Values
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `[
			{"id": 42, "trackName": "Fix You", "artistName": "Coldplay", "albumName": "X&Y", "duration": 296.4, "instrumental": false, "plainLyrics": "lights will guide you home", "syncedLyrics": "[00:10.00]lights will guide you home\n[00:12.50]and ignite your bones"},
			{"id": 43, "trackName": "Instrumental Take", "instrumental": true}
		]`)
	}))
	defer fake.Close()

	s := newServer(t, fake.URL, 0)
	admin := s.session(t, "u-admin", "admin", true)

	rec := s.do(t, http.MethodGet,
		"/api/lrclib/search?title=Fix%20You&artist=Coldplay&album=X%26Y&duration=296.4", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if gotQuery.Get("track_name") != "Fix You" || gotQuery.Get("artist_name") != "Coldplay" ||
		gotQuery.Get("album_name") != "X&Y" || gotQuery.Get("duration") != "296" {
		t.Fatalf("query = %v", gotQuery)
	}
	matches := decode(t, rec)["matches"].([]any)
	if len(matches) != 2 {
		t.Fatalf("matches = %d", len(matches))
	}
	first := matches[0].(map[string]any)
	if first["id"] != float64(42) || first["lyrics"] != "lights will guide you home" {
		t.Fatalf("match = %v", first)
	}
	synced := first["syncedLyrics"].([]any)
	if len(synced) != 2 || synced[0].(map[string]any)["time"] != float64(10) {
		t.Fatalf("synced = %v", synced)
	}
	second := matches[1].(map[string]any)
	if second["instrumental"] != true {
		t.Fatalf("instrumental = %v", second)
	}

	// Title is required.
	if rec := s.do(t, http.MethodGet, "/api/lrclib/search?artist=x", admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing title: want 400, got %d", rec.Code)
	}
}

func TestLrcLibRetriesOnceOn429(t *testing.T) {
	var hits int32
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `[]`)
	}))
	defer fake.Close()

	s := newServer(t, fake.URL, 0)
	admin := s.session(t, "u-admin", "admin", true)

	rec := s.do(t, http.MethodGet, "/api/lrclib/search?title=x", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if hits != 2 {
		t.Fatalf("hits = %d, want 2 (one retry)", hits)
	}
}

func TestLrcLibBoundedError(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"error": "internal secrets"}`)
	}))
	defer fake.Close()

	s := newServer(t, fake.URL, 0)
	admin := s.session(t, "u-admin", "admin", true)
	rec := s.do(t, http.MethodGet, "/api/lrclib/search?title=x", admin)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", rec.Code)
	}
	if body := rec.Body.String(); body != `{"error":"LRCLIB search failed"}`+"\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestProvidersAuthz(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `[]`)
	}))
	defer fake.Close()
	s := newServer(t, fake.URL, 0)

	if rec := s.do(t, http.MethodGet, "/api/musicbrainz/search?entityType=song&title=x", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous mb: want 401, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/lrclib/search?title=x", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous lrclib: want 401, got %d", rec.Code)
	}
	user := s.session(t, "u-1", "user", false)
	if rec := s.do(t, http.MethodGet, "/api/musicbrainz/search?entityType=song&title=x", user); rec.Code != http.StatusForbidden {
		t.Fatalf("user mb: want 403, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/lrclib/search?title=x", user); rec.Code != http.StatusForbidden {
		t.Fatalf("user lrclib: want 403, got %d", rec.Code)
	}
}
