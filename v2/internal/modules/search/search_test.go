package search_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/search"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type server struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
}

func newServer(t *testing.T, database *sql.DB) *server {
	t.Helper()
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	r := chi.NewRouter()
	search.NewHandler(search.NewService(database), mw).Routes(r)
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

// session mints a real session row and returns the signed cookie.
func (s *server) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
	t.Helper()
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

func (s *server) mustExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatalf("fixture exec: %v\n%s", err, query)
	}
}

// syncFTS mirrors PersistSong's index sync for rows inserted directly by
// the fixture (the same INSERT OR REPLACE the persist path runs).
func (s *server) syncFTS(t *testing.T) {
	t.Helper()
	s.mustExec(t, `INSERT OR REPLACE INTO songs_fts (rowid, title) SELECT rowid, title FROM songs WHERE active = 1`)
	s.mustExec(t, `INSERT OR REPLACE INTO albums_fts (rowid, name, artist_name) SELECT rowid, name, COALESCE(artist_name, '') FROM albums WHERE active = 1`)
	s.mustExec(t, `INSERT OR REPLACE INTO artists_fts (rowid, name) SELECT rowid, name FROM artists WHERE active = 1`)
}

// ---------------------------------------------------------------------------
// Fixture: two libraries, three users.
//
//	users: admin (all), alice → lib-a, carol → lib-b, bob → nothing
//	songs: lib-a: Blue Shadows / Blue Horizons / Bluer Than Blue (starred by
//	       alice), an explicit "Blue Streak", a Beta-song; lib-b: Beta Only
//	       (explicit); inactive: Ghost; null-library: NoLib (admin-only)
//	albums: Blueprints (Alpha), Blue Hour (Beta); lib-b: Beta Worlds
//	artists: Alpha, Beta, Gamma
//	playlists: alice-private, alice-public, alice-link, carol-shared (shared
//	       with alice), carol-private
// ---------------------------------------------------------------------------

func (s *server) seed(t *testing.T) {
	t.Helper()
	exec := s.mustExec
	exec(t, `INSERT INTO users (id, username, password_hash, is_admin) VALUES
		('user-admin', 'root', 'x', 1), ('user-alice', 'alice', 'x', 0),
		('user-bob', 'bob', 'x', 0), ('user-carol', 'carol', 'x', 0)`)
	exec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', '/music/a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
		('lib-b', 'Library B', '/music/b', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	exec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES
		('user-alice', 'lib-a'), ('user-carol', 'lib-b')`)

	exec(t, `INSERT INTO artists (id, name, active) VALUES
		('ar-alpha', 'Alpha', 1), ('ar-beta', 'Beta', 1), ('ar-gamma', 'Gamma', 1)`)
	exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, year, genre, active) VALUES
		('al-blueprints', 'Blueprints', 'ar-alpha', 'Alpha', 2020, 'Jazz', 1),
		('al-hour', 'Blue Hour', 'ar-beta', 'Beta', 2019, 'Ambient', 1),
		('al-worlds', 'Beta Worlds', 'ar-beta', 'Beta', 2018, 'Ambient', 1)`)
	exec(t, `INSERT INTO songs (id, file_path, title, artist_id, album_id, genre, year, mtime, checksum, explicit, active, library_id, duration) VALUES
		('s-shadows', '/music/a/01.flac', 'Blue Shadows', 'ar-alpha', 'al-blueprints', 'Jazz', 2020, 1, 'k1', 0, 1, 'lib-a', 200),
		('s-horizons', '/music/a/02.flac', 'Blue Horizons', 'ar-alpha', 'al-blueprints', 'Jazz', 2020, 2, 'k2', 0, 1, 'lib-a', 210),
		('s-bluer', '/music/a/03.flac', 'Bluer Than Blue', 'ar-alpha', 'al-blueprints', 'Jazz', 2021, 3, 'k3', 0, 1, 'lib-a', 190),
		('s-streak', '/music/a/04.flac', 'Blue Streak', 'ar-beta', 'al-hour', 'Ambient', 2019, 4, 'k4', 1, 1, 'lib-a', 180),
		('s-beta', '/music/a/05.flac', 'Beta Vulture', 'ar-beta', 'al-hour', 'Ambient', 2019, 5, 'k5', 0, 1, 'lib-a', 220),
		('s-ghost', '/music/a/06.flac', 'Blue Ghost', 'ar-alpha', 'al-blueprints', 'Jazz', 2020, 6, 'k6', 0, 0, 'lib-a', 200),
		('s-bonly', '/music/b/01.flac', 'Blue Beta', 'ar-beta', 'al-worlds', 'Ambient', 2018, 7, 'k7', 1, 1, 'lib-b', 240),
		('s-nolib', '/music/x/01.flac', 'Blue NoLib', 'ar-gamma', NULL, NULL, 2017, 8, 'k8', 0, 1, NULL, 150)`)
	exec(t, `INSERT INTO user_songs (user_id, song_id, starred, rating) VALUES
		('user-alice', 's-shadows', 1, 4.5)`)

	exec(t, `INSERT INTO playlists (id, name, owner_id, visibility, share_token, is_smart, created_at, updated_at) VALUES
		('pl-priv', 'Blue Mix', 'user-alice', 'private', NULL, 0, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
		('pl-pub', 'Blueprints Radio', 'user-alice', 'public', NULL, 0, '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'),
		('pl-link', 'Blue Link', 'user-alice', 'link', 'tok-1', 0, '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z'),
		('pl-shared', 'Blue Carol', 'user-carol', 'private', NULL, 0, '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z'),
		('pl-cpriv', 'Blue Secrets', 'user-carol', 'private', NULL, 0, '2026-01-01T00:00:00Z', '2026-01-06T00:00:00Z')`)
	exec(t, `INSERT INTO playlist_shares (playlist_id, user_id, can_edit) VALUES
		('pl-shared', 'user-alice', 0)`)

	s.syncFTS(t)
}

func newSeededServer(t *testing.T) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	s := newServer(t, database)
	s.seed(t)
	return s
}

func decodeResults(t *testing.T, rec *httptest.ResponseRecorder) search.Results {
	t.Helper()
	var results search.Results
	if err := json.Unmarshal(rec.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode results: %v (%s)", err, rec.Body.String())
	}
	return results
}

func songIDs(results search.Results) []string {
	ids := make([]string, len(results.Songs))
	for i, s := range results.Songs {
		ids[i] = s.ID
	}
	return ids
}

func contains(ids []string, want ...string) bool {
	set := map[string]bool{}
	for _, id := range ids {
		set[id] = true
	}
	for _, id := range want {
		if !set[id] {
			return false
		}
	}
	return true
}

func equals(ids []string, want ...string) bool {
	if len(ids) != len(want) {
		return false
	}
	for i := range want {
		if ids[i] != want[i] {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// Auth + validation
// ---------------------------------------------------------------------------

func TestSearchRequiresAuth(t *testing.T) {
	s := newSeededServer(t)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestSearchValidation(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	if rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=%20bogus", alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad type: want 400, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=bogus", alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown type: want 400, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/search?q=blue&limit=0", alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad limit: want 400, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/search?q=blue&limit=abc", alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("non-numeric limit: want 400, got %d", rec.Code)
	}
}

func TestSearchEmptyQueryReturnsEmptyCategories(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	results := decodeResults(t, rec)
	if len(results.Songs) != 0 || len(results.Albums) != 0 || len(results.Artists) != 0 || len(results.Playlists) != 0 {
		t.Fatalf("empty query must answer empty categories: %+v", results)
	}
}

// ---------------------------------------------------------------------------
// Category behavior
// ---------------------------------------------------------------------------

func TestSearchSongsPrefixAndScope(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=songs&limit=50", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	results := decodeResults(t, rec)
	// lib-a scope: the three Alpha blues + explicit Blue Streak + the
	// inactive Blue Ghost is NOT searchable. lib-b and null-library songs
	// are out of scope.
	ids := songIDs(results)
	if !contains(ids, "s-shadows", "s-horizons", "s-bluer", "s-streak") {
		t.Fatalf("missing expected lib-a hits: %v", ids)
	}
	for _, id := range ids {
		if id == "s-ghost" || id == "s-bonly" || id == "s-nolib" {
			t.Fatalf("out-of-scope/inactive song %s leaked", id)
		}
	}
}

func TestSearchSongsHideExplicit(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=songs&limit=50&hideExplicit=true", alice)
	results := decodeResults(t, rec)
	for _, song := range results.Songs {
		if song.Explicit {
			t.Fatalf("explicit song leaked with hideExplicit: %s", song.ID)
		}
	}
	if contains(songIDs(results), "s-streak") {
		t.Fatalf("explicit Blue Streak must be hidden: %v", songIDs(results))
	}
}

func TestSearchSongsAdminSeesEverything(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=songs&limit=50", admin)
	results := decodeResults(t, rec)
	ids := songIDs(results)
	if !contains(ids, "s-shadows", "s-bluer", "s-bonly", "s-nolib") {
		t.Fatalf("admin must see both libraries + null-library: %v", ids)
	}
	if contains(ids, "s-ghost") {
		t.Fatalf("inactive song leaked: %v", ids)
	}
}

func TestSearchSongsBobSeesNothing(t *testing.T) {
	s := newSeededServer(t)
	bob := s.session(t, "user-bob", "bob", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=songs&limit=50", bob)
	results := decodeResults(t, rec)
	if len(results.Songs) != 0 {
		t.Fatalf("bob has no library scope: %v", songIDs(results))
	}
}

func TestSearchInactiveSongNotMatched(t *testing.T) {
	s := newSeededServer(t)
	// s-ghost is inactive but still indexed (fixture bypassed the scanner's
	// delete); the active=1 join gate must exclude it.
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=ghost&type=songs", alice)
	results := decodeResults(t, rec)
	if len(results.Songs) != 0 {
		t.Fatalf("inactive song must not match: %v", songIDs(results))
	}
}

func TestSearchAlbumsAndArtists(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)

	rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=albums&limit=50", alice)
	results := decodeResults(t, rec)
	if len(results.Albums) != 2 {
		t.Fatalf("alice must find the two lib-a blue albums, got %d", len(results.Albums))
	}
	for _, a := range results.Albums {
		if a.ID == "al-worlds" {
			t.Fatalf("lib-b album leaked")
		}
	}

	// Album match through the artist_name text column too.
	rec = s.do(t, http.MethodGet, "/api/search?q=alpha&type=albums", alice)
	results = decodeResults(t, rec)
	found := false
	for _, a := range results.Albums {
		if a.ID == "al-blueprints" {
			found = true
		}
	}
	if !found {
		t.Fatalf("album search by artist text must hit Blueprints: %+v", results.Albums)
	}

	rec = s.do(t, http.MethodGet, "/api/search?q=beta&type=artists", alice)
	results = decodeResults(t, rec)
	if len(results.Artists) != 1 || results.Artists[0].ID != "ar-beta" {
		t.Fatalf("artist search: %+v", results.Artists)
	}
}

func TestSearchRankingPrefersExactPrefix(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	// All three Alpha songs match "blue"; "Blue Shadows" starts with the
	// query tokens, "Bluer Than Blue" only contains them later. bm25 must
	// rank the former first.
	rec := s.do(t, http.MethodGet, "/api/search?q=blue%20shad&type=songs", alice)
	results := decodeResults(t, rec)
	if len(results.Songs) == 0 || results.Songs[0].ID != "s-shadows" {
		t.Fatalf("ranking sanity: want Blue Shadows first, got %v", songIDs(results))
	}
}

// ---------------------------------------------------------------------------
// Special characters and fallback
// ---------------------------------------------------------------------------

func TestSearchSpecialCharacters(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	for _, q := range []string{"%blue", "bl_ue", "blue%", `"blue"`, `(blue)`, "blue:", "&&&"} {
		rec := s.do(t, http.MethodGet, "/api/search?q="+urlQueryEscape(q)+"&type=songs", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("query %q must not error: got %d", q, rec.Code)
		}
	}
	// A pure-specials query tokenizes to nothing → empty, not an error.
	rec := s.do(t, http.MethodGet, "/api/search?q=%22%22%22&type=songs", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("quote-only query: want 200, got %d", rec.Code)
	}
	if results := decodeResults(t, rec); len(results.Songs) != 0 {
		t.Fatalf("quote-only query must be empty: %v", songIDs(results))
	}
}

func TestSearchLikeEscapePercent(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	// "%" alone is escaped as a literal, so it matches nothing rather than
	// everything.
	rec := s.do(t, http.MethodGet, "/api/search?q=%25&type=songs", alice)
	results := decodeResults(t, rec)
	if len(results.Songs) != 0 {
		t.Fatalf("bare %% must be a literal, matched %v", songIDs(results))
	}
}

func urlQueryEscape(s string) string {
	r := ""
	for _, c := range []byte(s) {
		switch {
		case c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.' || c == '~':
			r += string(c)
		case c == ' ':
			r += "%20"
		default:
			r += fmtSprintf("%%%02X", c)
		}
	}
	return r
}

func fmtSprintf(f string, args ...any) string {
	return fmt.Sprintf(f, args...)
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

func TestSearchPlaylistScope(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=playlists&limit=50", alice)
	results := decodeResults(t, rec)
	ids := []string{}
	for _, p := range results.Playlists {
		ids = append(ids, p.ID)
	}
	// owner (priv, pub, link) + public (pub) + shared (shared).
	if !contains(ids, "pl-priv", "pl-pub", "pl-link", "pl-shared") {
		t.Fatalf("alice must see owner/public/shared playlists: %v", ids)
	}
	if contains(ids, "pl-cpriv") {
		t.Fatalf("carol's private playlist leaked to alice")
	}
}

func TestSearchPlaylistScopeCarol(t *testing.T) {
	s := newSeededServer(t)
	carol := s.session(t, "user-carol", "carol", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=playlists&limit=50", carol)
	results := decodeResults(t, rec)
	ids := []string{}
	for _, p := range results.Playlists {
		ids = append(ids, p.ID)
	}
	if !contains(ids, "pl-shared", "pl-cpriv", "pl-pub") {
		t.Fatalf("carol must see her own + public: %v", ids)
	}
	if contains(ids, "pl-priv", "pl-link") {
		t.Fatalf("alice's private/link playlists leaked to carol: %v", ids)
	}
}

func TestSearchTypeFilterSkipsOtherCategories(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue&type=albums", alice)
	results := decodeResults(t, rec)
	if len(results.Songs) != 0 || len(results.Artists) != 0 || len(results.Playlists) != 0 {
		t.Fatalf("type=albums must skip other categories: %+v", results)
	}
}

func TestSearchStarredAndRelations(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/search?q=blue%20shadows&type=songs", alice)
	results := decodeResults(t, rec)
	if len(results.Songs) != 1 {
		t.Fatalf("want one hit, got %v", songIDs(results))
	}
	song := results.Songs[0]
	if !song.Starred || song.Rating == nil || *song.Rating != 4.5 {
		t.Fatalf("interaction state missing: %+v", song)
	}
	if song.ArtistName == nil || *song.ArtistName != "Alpha" || song.AlbumName == nil || *song.AlbumName != "Blueprints" {
		t.Fatalf("display names missing: %+v", song)
	}
}
