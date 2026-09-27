package home_test

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
	"github.com/miquelrosell99/sonarly/server/internal/modules/home"
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
	home.NewHandler(home.NewService(database), mw).Routes(r)
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

// ---------------------------------------------------------------------------
// Fixture: two libraries, three users.
//
//	users: admin (all), alice → lib-a, carol → lib-b
//	lib-a albums: Hot Album (Rock, 3 songs — one explicit), Cold Album (Jazz,
//		2 songs), Quiet Album (no plays)
//	lib-b album: Beta Worlds (alice cannot see it)
//	alice's plays: Hot ×7 across three songs (one of them the explicit
//		s-h3), Cold ×2 (last played 2026-09-20); s-h1 and s-h2 share a
//		last_played to exercise the recently-played title tiebreak
//	genres by in-scope song count: Rock 3, Jazz 1
//	song mtimes deliberately shuffle import order: recency follows the
//		file mtime (MAX per album), not the rowid
// ---------------------------------------------------------------------------

func (s *server) seed(t *testing.T) {
	t.Helper()
	exec := s.mustExec
	exec(t, `INSERT INTO users (id, username, password_hash, is_admin) VALUES
		('user-admin', 'root', 'x', 1), ('user-alice', 'alice', 'x', 0), ('user-carol', 'carol', 'x', 0)`)
	exec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', '/music/a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
		('lib-b', 'Library B', '/music/b', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	exec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES
		('user-alice', 'lib-a'), ('user-carol', 'lib-b')`)
	exec(t, `INSERT INTO artists (id, name, active) VALUES ('ar-hot', 'Hot Artist', 1), ('ar-cold', 'Cold Artist', 1), ('ar-beta', 'Beta', 1)`)
	exec(t, `INSERT INTO genres (id, name, active) VALUES ('g-rock', 'Rock', 1), ('g-jazz', 'Jazz', 1)`)
	exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, year, genre, active) VALUES
		('al-hot', 'Hot Album', 'ar-hot', 'Hot Artist', 2020, 'Rock', 1),
		('al-cold', 'Cold Album', 'ar-cold', 'Cold Artist', 2019, 'Jazz', 1),
		('al-quiet', 'Quiet Album', 'ar-hot', 'Hot Artist', 2021, 'Rock', 1),
		('al-worlds', 'Beta Worlds', 'ar-beta', 'Beta', 2018, 'Ambient', 1)`)
	exec(t, `INSERT INTO songs (id, file_path, title, artist_id, album_id, genre, genre_id, year, mtime, checksum, explicit, active, library_id, duration) VALUES
		('s-q1', '/music/a/q1.flac', 'Quiet One', 'ar-hot', 'al-quiet', 'Rock', 'g-rock', 2021, 900, 'kq1', 0, 1, 'lib-a', 100),
		('s-h1', '/music/a/h1.flac', 'Hot One', 'ar-hot', 'al-hot', 'Rock', 'g-rock', 2020, 300, 'kh1', 0, 1, 'lib-a', 100),
		('s-h2', '/music/a/h2.flac', 'Hot Two', 'ar-hot', 'al-hot', 'Rock', 'g-rock', 2020, 100, 'kh2', 0, 1, 'lib-a', 100),
		('s-h3', '/music/a/h3.flac', 'Hot Three Explicit', 'ar-hot', 'al-hot', 'Rock', 'g-rock', 2020, 200, 'kh3', 1, 1, 'lib-a', 100),
		('s-c1', '/music/a/c1.flac', 'Cold One', 'ar-cold', 'al-cold', 'Jazz', 'g-jazz', 2019, 400, 'kc1', 0, 1, 'lib-a', 100),
		('s-c2', '/music/a/c2.flac', 'Cold Two', 'ar-cold', 'al-cold', 'Jazz', 'g-jazz', 2019, 500, 'kc2', 0, 1, 'lib-a', 100),
		('s-b1', '/music/b/b1.flac', 'Beta Song', 'ar-beta', 'al-worlds', 'Ambient', NULL, 2018, 600, 'kb1', 0, 1, 'lib-b', 100)`)

	exec(t, `INSERT INTO user_songs (user_id, song_id, play_count, last_played, starred) VALUES
		('user-alice', 's-h1', 4, '2026-09-18T10:00:00.000Z', 0),
		('user-alice', 's-h2', 2, '2026-09-18T10:00:00.000Z', 1),
		('user-alice', 's-h3', 1, '2026-07-01T10:00:00.000Z', 0),
		('user-alice', 's-c1', 1, '2026-09-20T10:00:00.000Z', 0),
		('user-alice', 's-c2', 1, '2026-08-01T10:00:00.000Z', 0)`)
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

func decodeHome(t *testing.T, rec *httptest.ResponseRecorder) home.Response {
	t.Helper()
	var resp home.Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode home: %v (%s)", err, rec.Body.String())
	}
	return resp
}

func albumIDs(albums []home.AlbumCard) []string {
	ids := make([]string, len(albums))
	for i, a := range albums {
		ids[i] = a.ID
	}
	return ids
}

func songIDs(songs []home.SongCard) []string {
	ids := make([]string, len(songs))
	for i, s := range songs {
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

func TestHomeRequiresAuth(t *testing.T) {
	s := newSeededServer(t)
	if rec := s.do(t, http.MethodGet, "/api/home", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestHomeShapes(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/home", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	resp := decodeHome(t, rec)

	// Genres ranked by in-scope song count: Rock 4 (incl. the Quiet Album
	// track), Jazz 2.
	if len(resp.Genres) != 2 ||
		resp.Genres[0].Name != "Rock" || resp.Genres[0].SongCount != 4 ||
		resp.Genres[1].Name != "Jazz" || resp.Genres[1].SongCount != 2 {
		t.Fatalf("genres: %+v", resp.Genres)
	}

	// Most played: Hot (7 plays) before Cold (2); Quiet never played still
	// appears for the admin-style query? Alice is scoped → inner join:
	// albums need in-scope songs, but zero-play albums survive the inner
	// join (the LEFT user_songs keeps them) and sort last.
	ids := albumIDs(resp.MostPlayed)
	if !contains(ids, "al-hot", "al-cold", "al-quiet") {
		t.Fatalf("most played missing albums: %v", ids)
	}
	if ids[0] != "al-hot" {
		t.Fatalf("Hot Album must lead most played: %v", ids)
	}

	// Recent additions: album cards by the newest in-scope song mtime
	// (Quiet 900, Cold 500, Hot 300).
	if !equals(albumIDs(resp.RecentAdditions), []string{"al-quiet", "al-cold", "al-hot"}) {
		t.Fatalf("recent additions order: %v", albumIDs(resp.RecentAdditions))
	}
	if resp.RecentAdditions[0].ArtistName == nil || *resp.RecentAdditions[0].ArtistName != "Hot Artist" {
		t.Fatalf("recent additions display names: %+v", resp.RecentAdditions[0])
	}

	// Recently played: the caller's songs by last_played DESC; s-h1/s-h2 tie
	// on 2026-09-18 and fall back to the title (Hot One before Hot Two).
	playedIDs := songIDs(resp.RecentlyPlayed)
	if !equals(playedIDs, []string{"s-c1", "s-h1", "s-h2", "s-c2", "s-h3"}) {
		t.Fatalf("recently played: %v", playedIDs)
	}
	if resp.RecentlyPlayed[0].ArtistName == nil || *resp.RecentlyPlayed[0].ArtistName != "Cold Artist" ||
		resp.RecentlyPlayed[0].AlbumName == nil || *resp.RecentlyPlayed[0].AlbumName != "Cold Album" {
		t.Fatalf("recently played display names: %+v", resp.RecentlyPlayed[0])
	}

	// Random: same in-scope album universe, size clamped.
	if len(resp.Random) == 0 || len(resp.Random) > 10 {
		t.Fatalf("random section size: %d", len(resp.Random))
	}
	if !contains(albumIDs(resp.Random), "al-hot", "al-cold", "al-quiet") && len(resp.Random) != 3 {
		t.Fatalf("random draws from scoped albums: %v", albumIDs(resp.Random))
	}
}

func TestHomeScopeIsolation(t *testing.T) {
	s := newSeededServer(t)
	carol := s.session(t, "user-carol", "carol", false)
	rec := s.do(t, http.MethodGet, "/api/home", carol)
	resp := decodeHome(t, rec)

	// Carol only reaches lib-b.
	for _, a := range resp.MostPlayed {
		if a.ID != "al-worlds" {
			t.Fatalf("lib-a album leaked to carol: %v", albumIDs(resp.MostPlayed))
		}
	}
	if !equals(albumIDs(resp.RecentAdditions), []string{"al-worlds"}) {
		t.Fatalf("carol recent additions: %v", albumIDs(resp.RecentAdditions))
	}
	// Carol's recently-played draws on her own user_songs rows — none exist
	// → empty (the guest/share-viewer contract: no owner fallback), not an
	// error.
	if len(resp.RecentlyPlayed) != 0 || len(resp.MostPlayed) != 1 {
		t.Fatalf("carol sections: played=%v most=%v", songIDs(resp.RecentlyPlayed), albumIDs(resp.MostPlayed))
	}
	if len(resp.Genres) != 1 || resp.Genres[0].Name != "Ambient" {
		t.Fatalf("carol genres: %+v", resp.Genres)
	}
}

func TestHomeHideExplicit(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/home?hideExplicit=true", alice)
	resp := decodeHome(t, rec)
	// Album sections keep the old HAVING rule: an album keeps its slot while
	// at least one in-scope song is non-explicit — none of the fixture
	// albums are explicit-only, so the mtime order is unchanged.
	if !equals(albumIDs(resp.RecentAdditions), []string{"al-quiet", "al-cold", "al-hot"}) {
		t.Fatalf("recent additions under hideExplicit: %v", albumIDs(resp.RecentAdditions))
	}
	if !contains(albumIDs(resp.MostPlayed), "al-hot") {
		t.Fatalf("Hot Album must survive hideExplicit")
	}
	// The song list drops the explicit Hot Three outright.
	if !equals(songIDs(resp.RecentlyPlayed), []string{"s-c1", "s-h1", "s-h2", "s-c2"}) {
		t.Fatalf("recently played under hideExplicit: %v", songIDs(resp.RecentlyPlayed))
	}
}

func TestHomeRandomSeeded(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	// The same seed produces the same draw; different seeds produce a
	// permutation of the same universe (service-level check via repeated
	// identical requests is impossible through the route, which draws a
	// fresh seed — so assert the universe and the clamp instead).
	rec := s.do(t, http.MethodGet, "/api/home?limit=2", alice)
	resp := decodeHome(t, rec)
	if len(resp.Random) != 2 {
		t.Fatalf("random limit=2: got %d", len(resp.Random))
	}
	rec = s.do(t, http.MethodGet, "/api/home?limit=500", alice)
	resp = decodeHome(t, rec)
	if len(resp.Random) != 3 {
		t.Fatalf("random limit clamps to the album universe: got %d", len(resp.Random))
	}
	rec = s.do(t, http.MethodGet, "/api/home?limit=0", alice)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("limit=0: want 400, got %d", rec.Code)
	}
}

func TestHomeLibraryFilter(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	rec := s.do(t, http.MethodGet, "/api/home?libraryId=lib-b", admin)
	resp := decodeHome(t, rec)
	if !equals(albumIDs(resp.RecentAdditions), []string{"al-worlds"}) {
		t.Fatalf("libraryId filter: %v", albumIDs(resp.RecentAdditions))
	}
	// The admin has no user_songs rows of their own: an empty
	// recently-played, never a fallback to another user's history.
	if len(resp.RecentlyPlayed) != 0 {
		t.Fatalf("admin recently played: %v", songIDs(resp.RecentlyPlayed))
	}
}

func TestHomeRecentAdditionsMtime(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)

	// Legacy databases stored mtimes as fractional REALs (better-sqlite3
	// stat.mtimeMs). The MAX aggregate must scan through the tolerant
	// db.Millis instead of blowing up on a float64.
	s.mustExec(t, `UPDATE songs SET mtime = 900.5 WHERE id = 's-c1'`)
	rec := s.do(t, http.MethodGet, "/api/home", alice)
	resp := decodeHome(t, rec)
	if !equals(albumIDs(resp.RecentAdditions), []string{"al-cold", "al-quiet", "al-hot"}) {
		t.Fatalf("REAL mtime order: %v", albumIDs(resp.RecentAdditions))
	}

	// An exact mtime tie falls back to the album name: Cold before Quiet.
	s.mustExec(t, `UPDATE songs SET mtime = 900 WHERE id = 's-c1'`)
	rec = s.do(t, http.MethodGet, "/api/home", alice)
	resp = decodeHome(t, rec)
	if !equals(albumIDs(resp.RecentAdditions), []string{"al-cold", "al-quiet", "al-hot"}) {
		t.Fatalf("tied mtime order: %v", albumIDs(resp.RecentAdditions))
	}
}

func TestHomeRecentlyPlayedGuest(t *testing.T) {
	s := newSeededServer(t)
	// A guest/anonymous principal (share-link viewer) has no user_songs
	// rows and an empty library scope: the section comes back empty rather
	// than falling back to the owner's history.
	resp, err := home.NewService(s.db).Home(context.Background(), auth.Identity{}, "", false, 10, 1)
	if err != nil {
		t.Fatalf("guest home: %v", err)
	}
	if len(resp.RecentlyPlayed) != 0 {
		t.Fatalf("guest recently played must be empty: %v", songIDs(resp.RecentlyPlayed))
	}
	// The album sections honour the empty scope too.
	if len(resp.RecentAdditions) != 0 || len(resp.MostPlayed) != 0 {
		t.Fatalf("guest album sections must be empty: additions=%v most=%v",
			albumIDs(resp.RecentAdditions), albumIDs(resp.MostPlayed))
	}
}

func equals(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
