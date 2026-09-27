package autodj

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type server struct {
	db     *sql.DB
	store  *auth.Store
	svc    *Service
	router http.Handler
}

func newServer(t *testing.T, database *sql.DB) *server {
	t.Helper()
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	svc := NewService(database)
	r := chi.NewRouter()
	NewHandler(svc, mw).Routes(r)
	return &server{db: database, store: store, svc: svc, router: r}
}

func (s *server) do(t *testing.T, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader = strings.NewReader(body)
	req := httptest.NewRequest(method, path, reader)
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
// Fixture: one seeded library plus a second, out-of-scope one. The scoring
// fixture pins the clock at 2026-09-25T12:00:00Z so the <24h recency window
// is deterministic.
// ---------------------------------------------------------------------------

func (s *server) seed(t *testing.T) {
	t.Helper()
	exec := s.mustExec
	exec(t, `INSERT INTO users (id, username, password_hash, is_admin) VALUES
		('user-alice', 'alice', 'x', 0), ('user-carol', 'carol', 'x', 0)`)
	exec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', '/music/a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
		('lib-b', 'Library B', '/music/b', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	exec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES
		('user-alice', 'lib-a'), ('user-carol', 'lib-b')`)
	exec(t, `INSERT INTO artists (id, name, active) VALUES
		('ar-anchor', 'Anchor Artist', 1), ('ar-other', 'Other Artist', 1), ('ar-far', 'Far Artist', 1), ('ar-beta', 'Beta', 1)`)
	exec(t, `INSERT INTO genres (id, name, active) VALUES
		('g-rock', 'Rock', 1), ('g-jazz', 'Jazz', 1), ('g-classical', 'Classical', 1)`)
	exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, active) VALUES
		('al-anchor', 'Anchor Album', 'ar-anchor', 'Anchor Artist', 1),
		('al-x', 'Album X', 'ar-anchor', 'Anchor Artist', 1),
		('al-y', 'Album Y', 'ar-other', 'Other Artist', 1),
		('al-z', 'Album Z', 'ar-other', 'Other Artist', 1),
		('al-far', 'Far Album', 'ar-far', 'Far Artist', 1),
		('al-worlds', 'Beta Worlds', 'ar-beta', 'Beta', 1)`)
	exec(t, `INSERT INTO songs (id, file_path, title, artist_id, album_id, genre, genre_id, year, mtime, checksum, explicit, active, library_id, bpm, mood, duration) VALUES
		('s-anchor', '/a/anchor.flac', 'Anchor', 'ar-anchor', 'al-anchor', 'Rock', 'g-rock', 2020, 1, 'ka', 0, 1, 'lib-a', 120, 'dark', 200),
		('s-artist', '/a/artist.flac', 'Same Artist Song', 'ar-anchor', 'al-x', 'Jazz', 'g-jazz', 2020, 2, 'kb', 0, 1, 'lib-a', NULL, NULL, 200),
		('s-album', '/a/album.flac', 'Same Album Song', 'ar-other', 'al-anchor', 'Jazz', 'g-jazz', 2020, 3, 'kc', 0, 1, 'lib-a', NULL, NULL, 200),
		('s-genre', '/a/genre.flac', 'Same Genre Song', 'ar-other', 'al-y', 'Rock', 'g-rock', 2020, 4, 'kd', 0, 1, 'lib-a', NULL, NULL, 200),
		('s-twogenre', '/a/two.flac', 'Two Genre Song', 'ar-other', 'al-z', 'Rock', 'g-rock', 2020, 5, 'ke', 0, 1, 'lib-a', NULL, NULL, 200),
		('s-far', '/a/far.flac', 'Unrelated Song', 'ar-far', 'al-far', 'Classical', 'g-classical', 2020, 6, 'kf', 0, 1, 'lib-a', NULL, NULL, 200),
		('s-exp', '/a/exp.flac', 'Explicit Song', 'ar-far', 'al-far', 'Classical', 'g-classical', 2020, 7, 'kg', 1, 1, 'lib-a', NULL, NULL, 200),
		('s-b1', '/b/one.flac', 'Beta Song', 'ar-beta', 'al-worlds', NULL, NULL, 2020, 8, 'kh', 0, 1, 'lib-b', NULL, NULL, 200)`)
	exec(t, `INSERT INTO song_genres (song_id, genre_id, position) VALUES
		('s-anchor', 'g-rock', 0),
		('s-artist', 'g-jazz', 0),
		('s-album', 'g-jazz', 0),
		('s-genre', 'g-rock', 0),
		('s-twogenre', 'g-rock', 0), ('s-twogenre', 'g-jazz', 1),
		('s-far', 'g-classical', 0),
		('s-exp', 'g-classical', 0)`)
	// The SQL-side windows compare against the real clock, so the fixture
	// timestamps are relative to now: s-genre played an hour ago (excluded
	// from the similar/smart pools), s-artist's last_played an hour ago
	// (recent for the smart penalty AND the random-mode window).
	now := time.Now().UTC()
	hourAgo := now.Add(-time.Hour).Format("2006-01-02 15:04:05")
	twoHoursAgo := now.Add(-2 * time.Hour).Format("2006-01-02 15:04:05")
	hourAgoISO := now.Add(-time.Hour).Format(time.RFC3339Nano)
	twoHoursAgoISO := now.Add(-2 * time.Hour).Format(time.RFC3339Nano)
	exec(t, `INSERT INTO user_songs (user_id, song_id, starred, rating, play_count, last_played) VALUES
		('user-alice', 's-anchor', 0, 4, 8, ?),
		('user-alice', 's-artist', 0, 5, 10, ?),
		('user-alice', 's-album', 0, 4, 0, NULL),
		('user-alice', 's-genre', 0, 3, 5, NULL),
		('user-alice', 's-twogenre', 1, 5, 0, NULL),
		('user-alice', 's-far', 0, 2, 0, NULL),
		('user-alice', 's-exp', 0, 1, 0, NULL)`, twoHoursAgo, hourAgo)
	exec(t, `INSERT INTO listening_history (id, user_id, song_id, played_at, duration_listened) VALUES
		('h1', 'user-alice', 's-genre', ?, 100),
		('h2', 'user-alice', 's-anchor', ?, 100)`, hourAgoISO, twoHoursAgoISO)
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

func decodeSongs(t *testing.T, rec *httptest.ResponseRecorder) []Song {
	t.Helper()
	var body struct {
		Songs []Song `json:"songs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return body.Songs
}

func songIDSet(songs []Song) map[string]bool {
	set := map[string]bool{}
	for _, s := range songs {
		if set[s.ID] {
			t := "duplicate " + s.ID
			panic(t)
		}
		set[s.ID] = true
	}
	return set
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

func TestSmartModeDeterministicScoring(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=smart&count=3&currentSongId=s-anchor", "", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	songs := decodeSongs(t, rec)
	if len(songs) != 3 {
		t.Fatalf("want 3 songs, got %d", len(songs))
	}
	// Golden scores (discovery defaults to 50 → familiarity bias 0; average
	// play count 23/7 ≈ 3.29; the context carries only g-rock, so
	// s-twogenre's overlap is 1):
	//   s-twogenre: genre overlap 1×2 + rating 5            = 7
	//   s-artist:   artist +3 + rating 5 − recency 2 − overplayed 0.5 = 5.5
	//   s-far:      rating 2                                = 2
	// s-album scores −5 + 4 = −1; s-exp scores 1; s-genre is outside the
	// pool (played within the 24h window).
	ids := []string{songs[0].ID, songs[1].ID, songs[2].ID}
	if ids[0] != "s-twogenre" || ids[1] != "s-artist" || ids[2] != "s-far" {
		t.Fatalf("smart order: %v", ids)
	}
}

func TestSmartModeBackfillsWhenPoolIsShort(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=smart&count=6&currentSongId=s-anchor", "", alice)
	songs := decodeSongs(t, rec)
	if len(songs) != 6 {
		t.Fatalf("backfill must still answer count songs, got %d", len(songs))
	}
	set := songIDSet(songs)
	for id := range set {
		if id == "s-anchor" || id == "s-b1" {
			t.Fatalf("excluded/out-of-scope song %s in result", id)
		}
	}
	// wire parity: the random backfill applies the us.last_played window, not
	// the listening_history window, so s-genre may legitimately return.
}

func TestSimilarModeOverlapSet(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=similar&count=3&currentSongId=s-anchor", "", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	songs := decodeSongs(t, rec)
	set := songIDSet(songs)
	want := map[string]bool{"s-artist": true, "s-album": true, "s-twogenre": true}
	if len(set) != 3 {
		t.Fatalf("similar must return exactly the overlap set, got %v", set)
	}
	for id := range want {
		if !set[id] {
			t.Fatalf("similar missing %s: %v", id, set)
		}
	}
}

func TestSimilarModeBackfillsBeyondOverlap(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=similar&count=5&currentSongId=s-anchor", "", alice)
	songs := decodeSongs(t, rec)
	if len(songs) != 5 {
		t.Fatalf("want 5, got %d", len(songs))
	}
	// First three are the overlap pool (in random order); the last two are
	// random backfill from the scoped library.
	set := songIDSet(songs)
	for _, song := range songs[3:] {
		if song.ID == "s-anchor" || song.ID == "s-b1" {
			t.Fatalf("backfill leaked %s", song.ID)
		}
	}
	_ = set
}

func TestRandomModeWindowAndScope(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=random&count=4", "", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	songs := decodeSongs(t, rec)
	if len(songs) != 4 {
		t.Fatalf("want 4, got %d", len(songs))
	}
	set := songIDSet(songs)
	// s-artist played within the window (us.last_played), s-b1 out of scope.
	for id := range set {
		if id == "s-artist" || id == "s-b1" || id == "s-anchor" {
			t.Fatalf("random leaked %s", id)
		}
	}
}

func TestRandomModeExcludesIds(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	// Exclude everything except s-far: the window pass finds nothing, the
	// no-window fallback still honors the exclusion list and returns s-far.
	rec := s.do(t, http.MethodGet,
		"/api/playback/auto-dj?mode=random&count=4&excludeIds=s-album,s-genre,s-twogenre,s-exp,s-artist,s-anchor",
		"", alice)
	songs := decodeSongs(t, rec)
	if len(songs) != 1 || songs[0].ID != "s-far" {
		t.Fatalf("want only s-far, got %+v", songs)
	}
}

func TestModesRespectLibraryScope(t *testing.T) {
	s := newSeededServer(t)
	carol := s.session(t, "user-carol", "carol", false)
	for _, mode := range []string{"random", "similar", "smart"} {
		rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode="+mode+"&count=5&currentSongId=s-b1", "", carol)
		songs := decodeSongs(t, rec)
		for _, song := range songs {
			if song.ID != "s-b1" {
				t.Fatalf("carol's %s result leaked lib-a: %s", mode, song.ID)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Options from stored preferences
// ---------------------------------------------------------------------------

func TestOptionsComeFromStoredPreferences(t *testing.T) {
	s := newSeededServer(t)
	// Discovery pinned to 100 (adventurous), favorites preferred, window 7d.
	s.mustExec(t, `INSERT INTO user_preferences (user_id, preferences) VALUES ('user-alice', ?)`,
		`{"autoDjDiscovery": 100, "autoDjPreferFavorites": true, "autoDjExcludeWindow": "7d"}`)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=smart&count=2&currentSongId=s-anchor", "", alice)
	songs := decodeSongs(t, rec)
	// bias = (50-100)/50 = -1: s-twogenre gets the deep-cut lift (+2) and
	// the starred bonus (+3) on top of its 9.
	if len(songs) != 2 || songs[0].ID != "s-twogenre" {
		t.Fatalf("prefs-driven smart: %+v", songs)
	}
}

func TestInvalidPreferenceValuesFallBack(t *testing.T) {
	s := newSeededServer(t)
	s.mustExec(t, `INSERT INTO user_preferences (user_id, preferences) VALUES ('user-alice', ?)`,
		`{"autoDjExcludeWindow": "bogus", "autoDjDiscovery": 500}`)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=smart&count=3&currentSongId=s-anchor", "", alice)
	songs := decodeSongs(t, rec)
	// Window falls back to 24h; discovery clamps to 100 → same winner.
	if len(songs) != 3 || songs[0].ID != "s-twogenre" {
		t.Fatalf("fallback prefs: %+v", songs)
	}
}

// ---------------------------------------------------------------------------
// Validation, errors, authz
// ---------------------------------------------------------------------------

func TestAutoDjValidation(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	cases := []struct {
		name string
		path string
	}{
		{"missing mode", "/api/playback/auto-dj?count=5"},
		{"bad mode", "/api/playback/auto-dj?mode=bogus&count=5"},
		{"count too big", "/api/playback/auto-dj?mode=random&count=51"},
		{"count zero", "/api/playback/auto-dj?mode=random&count=0"},
	}
	for _, tc := range cases {
		if rec := s.do(t, http.MethodGet, tc.path, "", alice); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", tc.name, rec.Code)
		}
	}
	if rec := s.do(t, http.MethodPost, "/api/playback/auto-dj", "{not json", alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid json: want 400, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPost, "/api/playback/auto-dj", `{"mode":"random","count":99}`, alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad post count: want 400, got %d", rec.Code)
	}
	tooMany := make([]string, maxExcludeIDs+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("id-%d", i)
	}
	body := `{"mode":"random","count":5,"excludeIds":` + jsonArray(tooMany) + `}`
	if rec := s.do(t, http.MethodPost, "/api/playback/auto-dj", body, alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("over-long excludeIds: want 400, got %d", rec.Code)
	}
}

func jsonArray(items []string) string {
	quoted := make([]string, len(items))
	for i, item := range items {
		quoted[i] = `"` + item + `"`
	}
	return "[" + strings.Join(quoted, ",") + "]"
}

func TestAutoDjPostVariantMatchesGet(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodPost, "/api/playback/auto-dj",
		`{"mode":"similar","count":3,"currentSongId":"s-anchor","excludeIds":["s-album"]}`, alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	songs := decodeSongs(t, rec)
	set := songIDSet(songs)
	if set["s-album"] || set["s-anchor"] {
		t.Fatalf("post exclusions not honored: %v", set)
	}
}

func TestAutoDjGenerationFailureSurfaces502(t *testing.T) {
	s := newSeededServer(t)
	s.mustExec(t, `DROP TABLE songs`)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=random&count=5", "", alice)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected deviation: generation failures answer 502, got %d", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["error"] != "Auto-DJ generation failed" {
		t.Fatalf("typed 502 contract: %+v", body)
	}
}

func TestAutoDjAuthz(t *testing.T) {
	s := newSeededServer(t)
	if rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=random&count=5", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anon: want 401, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPost, "/api/playback/auto-dj", `{"mode":"random","count":5}`, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anon post: want 401, got %d", rec.Code)
	}
	alice := s.session(t, "user-alice", "alice", false)
	if rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=random&count=5", "", alice); rec.Code != http.StatusOK {
		t.Fatalf("alice: want 200, got %d", rec.Code)
	}
}

func TestAutoDjEmptyPoolIsEmptyListNotError(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	// Exclude every eligible song, including the recent-window ones.
	rec := s.do(t, http.MethodGet,
		"/api/playback/auto-dj?mode=random&count=5&excludeIds=s-album,s-far,s-exp,s-twogenre,s-genre,s-artist,s-anchor",
		"", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("empty pool answers 200, got %d", rec.Code)
	}
	if songs := decodeSongs(t, rec); len(songs) != 0 {
		t.Fatalf("empty pool must be an empty list: %+v", songs)
	}
}

// ---------------------------------------------------------------------------
// Seed awareness: the similarity anchor follows the session — queue tail,
// then listening history — when the current song carries no signal.
// ---------------------------------------------------------------------------

// seedSeeds builds a fixture with a signal-less song (no artist, album, or
// genres), a jazz-flavored queue tail, and a rock-history entry.
func (s *server) seedSeeds(t *testing.T) {
	t.Helper()
	exec := s.mustExec
	exec(t, `INSERT INTO users (id, username, password_hash, is_admin) VALUES ('user-alice', 'alice', 'x', 0)`)
	exec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES ('lib-a', 'Library A', '/music/a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	exec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES ('user-alice', 'lib-a')`)
	exec(t, `INSERT INTO artists (id, name, active) VALUES ('ar-jazz', 'Jazz Artist', 1), ('ar-rock', 'Rock Artist', 1)`)
	exec(t, `INSERT INTO genres (id, name, active) VALUES ('g-jazz', 'Jazz', 1), ('g-rock', 'Rock', 1)`)
	exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, active) VALUES
		('al-j1', 'Jazz One', 'ar-jazz', 'Jazz Artist', 1),
		('al-j2', 'Jazz Two', 'ar-jazz', 'Jazz Artist', 1),
		('al-r1', 'Rock One', 'ar-rock', 'Rock Artist', 1),
		('al-r2', 'Rock Two', 'ar-rock', 'Rock Artist', 1)`)
	exec(t, `INSERT INTO songs (id, file_path, title, artist_id, album_id, genre, genre_id, year, mtime, checksum, explicit, active, library_id) VALUES
		('s-plain', '/a/plain.flac', 'Plain', NULL, NULL, NULL, NULL, NULL, 1, 'kp', 0, 1, 'lib-a'),
		('s-jazzcur', '/a/jazzcur.flac', 'Jazz Current', 'ar-jazz', 'al-j1', 'Jazz', 'g-jazz', 1970, 2, 'kq', 0, 1, 'lib-a'),
		('s-j1a', '/a/j1a.flac', 'Jazz 1a', 'ar-jazz', 'al-j1', 'Jazz', 'g-jazz', 1965, 3, 'kr', 0, 1, 'lib-a'),
		('s-j1b', '/a/j1b.flac', 'Jazz 1b', 'ar-jazz', 'al-j1', 'Jazz', 'g-jazz', 1966, 4, 'ks', 0, 1, 'lib-a'),
		('s-j2', '/a/j2.flac', 'Jazz 2', 'ar-jazz', 'al-j2', 'Jazz', 'g-jazz', 1975, 5, 'kt', 0, 1, 'lib-a'),
		('s-r1', '/a/r1.flac', 'Rock 1', 'ar-rock', 'al-r1', 'Rock', 'g-rock', 1995, 6, 'ku', 0, 1, 'lib-a'),
		('s-r2', '/a/r2.flac', 'Rock 2', 'ar-rock', 'al-r2', 'Rock', 'g-rock', 1996, 7, 'kv', 0, 1, 'lib-a')`)
	exec(t, `INSERT INTO song_genres (song_id, genre_id, position) VALUES
		('s-jazzcur', 'g-jazz', 0), ('s-j1a', 'g-jazz', 0), ('s-j1b', 'g-jazz', 0),
		('s-j2', 'g-jazz', 0), ('s-r1', 'g-rock', 0), ('s-r2', 'g-rock', 0)`)
	// Relative to the real clock like the main fixture: s-r1 played 25 hours
	// ago — outside the 24h smart/similar recency window, still the latest
	// history row for the seed fallback.
	dayAgo := time.Now().UTC().Add(-25 * time.Hour).Format(time.RFC3339)
	exec(t, `INSERT INTO listening_history (id, user_id, song_id, played_at, duration_listened) VALUES
		('h1', 'user-alice', 's-r1', ?, 100)`, dayAgo)
}

func newSeededSeedsServer(t *testing.T) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	s := newServer(t, database)
	s.seedSeeds(t)
	return s
}

func TestSeedFallsBackToQueueTail(t *testing.T) {
	s := newSeededSeedsServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	// s-plain has no similarity signal; the posted queue tail (s-jazzcur)
	// must anchor the session — the batch stays Jazz-y and never contains
	// the tail itself.
	rec := s.do(t, http.MethodPost, "/api/playback/auto-dj",
		`{"mode":"smart","count":3,"currentSongId":"s-plain","queueIds":["s-plain","s-jazzcur"]}`, alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	songs := decodeSongs(t, rec)
	ids := []string{}
	for _, song := range songs {
		ids = append(ids, song.ID)
	}
	// Scores vs the s-jazzcur seed: s-j2 leads (+3 artist, +2 genre, no album
	// clash); the diversity caps then alternate out of the artist run before
	// pass 2 backfills one same-album-as-seed jazz cut.
	if strings.Join(ids, ",") != "s-j2,s-r1,s-j1a" {
		t.Fatalf("queue-tail seeding must stay in-family: %v", ids)
	}
	if songs[0].Reason != "More like Jazz Artist" {
		t.Fatalf("seed reason: %q", songs[0].Reason)
	}
}

func TestSeedFallsBackToListeningHistory(t *testing.T) {
	s := newSeededSeedsServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	// No current song, no queue: the most recently played track (s-r1, rock)
	// anchors the batch.
	rec := s.do(t, http.MethodPost, "/api/playback/auto-dj",
		`{"mode":"smart","count":2,"queueIds":[]}`, alice)
	songs := decodeSongs(t, rec)
	if len(songs) != 2 || songs[0].ID != "s-r2" || songs[1].ID != "s-j1a" {
		t.Fatalf("history seeding: %+v", songs)
	}
	if songs[0].Reason != "More like Rock Artist" {
		t.Fatalf("history seed reason: %q", songs[0].Reason)
	}
}

// ---------------------------------------------------------------------------
// Hard queue-duplicate rule + idempotent refresh.
// ---------------------------------------------------------------------------

func TestPostedQueueIdsAreHardExcluded(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	// s-twogenre and s-artist are the top-scoring picks; the posted queue
	// must remove them even though excludeIds stays empty.
	rec := s.do(t, http.MethodPost, "/api/playback/auto-dj",
		`{"mode":"smart","count":3,"currentSongId":"s-anchor","queueIds":["s-twogenre","s-artist"]}`, alice)
	songs := decodeSongs(t, rec)
	set := songIDSet(songs)
	if set["s-twogenre"] || set["s-artist"] || set["s-anchor"] {
		t.Fatalf("queue/seed duplicates leaked: %v", set)
	}
	if len(songs) != 3 {
		t.Fatalf("want a full batch from the remainder, got %+v", songs)
	}
	for _, song := range songs {
		if song.Reason == "" {
			t.Fatalf("every suggestion carries a reason: %+v", song)
		}
	}
}

func TestRefreshIsIdempotentAndDisjoint(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	body := func(exclude []string) string {
		quoted := make([]string, len(exclude))
		for i, id := range exclude {
			quoted[i] = `"` + id + `"`
		}
		return `{"mode":"smart","count":2,"currentSongId":"s-anchor","excludeIds":[` +
			strings.Join(quoted, ",") + `],"queueIds":[` + strings.Join(quoted, ",") + `]}`
	}

	first := decodeSongs(t, s.do(t, http.MethodPost, "/api/playback/auto-dj", body(nil), alice))
	if len(first) != 2 {
		t.Fatalf("first batch: %+v", first)
	}
	firstIDs := []string{first[0].ID, first[1].ID}

	second := decodeSongs(t, s.do(t, http.MethodPost, "/api/playback/auto-dj", body(firstIDs), alice))
	if len(second) != 2 {
		t.Fatalf("second batch: %+v", second)
	}
	secondSet := songIDSet(second)
	for _, id := range firstIDs {
		if secondSet[id] {
			t.Fatalf("refresh repeated %s: %v", id, secondSet)
		}
	}

	all := append(append([]string{}, firstIDs...), second[0].ID, second[1].ID)
	third := decodeSongs(t, s.do(t, http.MethodPost, "/api/playback/auto-dj", body(all), alice))
	seen := songIDSet(third)
	for _, id := range all {
		if seen[id] {
			t.Fatalf("third refresh repeated %s: %v", id, seen)
		}
	}
	// Stateless: replaying the first request reproduces the first batch.
	replay := decodeSongs(t, s.do(t, http.MethodPost, "/api/playback/auto-dj", body(nil), alice))
	if len(replay) != 2 || replay[0].ID != firstIDs[0] || replay[1].ID != firstIDs[1] {
		t.Fatalf("generation must be a pure function of its inputs: %+v", replay)
	}
}

// ---------------------------------------------------------------------------
// Reasons per mode.
// ---------------------------------------------------------------------------

func TestReasonsInSmartMode(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=smart&count=3&currentSongId=s-anchor", "", alice)
	songs := decodeSongs(t, rec)
	want := map[string]string{
		"s-twogenre": "Because you love Rock",
		"s-artist":   "More like Anchor Artist",
		"s-far":      "Hidden gem — you haven't played this",
	}
	for _, song := range songs {
		if want[song.ID] != "" && song.Reason != want[song.ID] {
			t.Fatalf("reason for %s: want %q, got %q", song.ID, want[song.ID], song.Reason)
		}
		if song.Reason == "" {
			t.Fatalf("missing reason on %+v", song)
		}
	}
}

func TestReasonsInSimilarMode(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=similar&count=3&currentSongId=s-anchor", "", alice)
	songs := decodeSongs(t, rec)
	want := map[string]string{
		"s-artist":   "More like Anchor Artist",
		"s-album":    "From the same album",
		"s-twogenre": "Because you love Rock",
	}
	seen := map[string]bool{}
	for _, song := range songs {
		seen[song.ID] = true
		if want[song.ID] != "" && song.Reason != want[song.ID] {
			t.Fatalf("reason for %s: want %q, got %q", song.ID, want[song.ID], song.Reason)
		}
	}
	for id := range want {
		if !seen[id] {
			t.Fatalf("similar batch missing %s: %v", id, seen)
		}
	}
}

func TestReasonsInRandomMode(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/playback/auto-dj?mode=random&count=4", "", alice)
	songs := decodeSongs(t, rec)
	if len(songs) != 4 {
		t.Fatalf("want 4, got %+v", songs)
	}
	want := map[string]string{
		"s-twogenre": "One of your favorites",
		"s-album":    "From your highly rated",
		"s-far":      "Hidden gem — you haven't played this",
		"s-exp":      "Hidden gem — you haven't played this",
		"s-genre":    "Fresh pick from your library",
	}
	for _, song := range songs {
		if want[song.ID] != "" && song.Reason != want[song.ID] {
			t.Fatalf("reason for %s: want %q, got %q", song.ID, want[song.ID], song.Reason)
		}
		if song.Reason == "" {
			t.Fatalf("missing reason on %+v", song)
		}
	}
}

// ---------------------------------------------------------------------------
// Exclude windows through the POST variant + queueIds validation.
// ---------------------------------------------------------------------------

func TestPostRespectsExcludeWindowAndCaps(t *testing.T) {
	s := newSeededServer(t)
	s.mustExec(t, `INSERT INTO user_preferences (user_id, preferences) VALUES ('user-alice', ?)`,
		`{"autoDjExcludeWindow": "7d"}`)
	alice := s.session(t, "user-alice", "alice", false)
	// count 4 leaves the windowed pool (5 songs minus the history seed) big
	// enough to fill the batch, so the no-window fallback pass never runs.
	rec := s.do(t, http.MethodPost, "/api/playback/auto-dj",
		`{"mode":"random","count":4,"queueIds":[]}`, alice)
	songs := decodeSongs(t, rec)
	set := songIDSet(songs)
	// s-artist and s-anchor were played within the 7d user_songs window.
	for _, id := range []string{"s-artist", "s-anchor"} {
		if set[id] {
			t.Fatalf("7d window leaked %s: %v", id, set)
		}
	}

	tooMany := make([]string, maxQueueIDs+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("id-%d", i)
	}
	body := `{"mode":"random","count":5,"queueIds":` + jsonArray(tooMany) + `}`
	if rec := s.do(t, http.MethodPost, "/api/playback/auto-dj", body, alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("over-long queueIds: want 400, got %d", rec.Code)
	}
}
