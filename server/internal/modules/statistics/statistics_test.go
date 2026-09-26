package statistics_test

import (
	"strings"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"modernc.org/sqlite"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/statistics"
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
	statistics.NewHandler(statistics.NewService(database), mw).Routes(r)
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
// Fixture: two users with deterministic listening history.
//
//	alice: s1 ×5 (3 in Aug, 2 in Sep), s2 ×3 (Sep), s3 ×2 (Sep)
//	       durations: s1=100, s2=200, s3=150 → total 10 plays, 1400s
//	       ratings: s1=5, s2=4, s3=3 (global average 4.0); s4 unrated row
//	       starred: s1
//	carol: s1 ×1 (Sep, 100s)
//	s5 is inactive: alice played it once in Sep but it must count NOWHERE.
// ---------------------------------------------------------------------------

func (s *server) seed(t *testing.T) {
	t.Helper()
	exec := s.mustExec
	exec(t, `INSERT INTO users (id, username, password_hash, is_admin, name, surname) VALUES
		('user-admin', 'root', 'x', 1, NULL, NULL),
		('user-alice', 'alice', 'x', 0, 'Alice', 'A'),
		('user-carol', 'carol', 'x', 0, NULL, NULL)`)
	exec(t, `INSERT INTO artists (id, name, active) VALUES ('ar-a', 'Artist A', 1), ('ar-b', 'Artist B', 1)`)
	exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, active) VALUES
		('al-a', 'Album A', 'ar-a', 'Artist A', 1),
		('al-b', 'Album B', 'ar-a', 'Artist A', 1),
		('al-c', 'Album C', 'ar-b', 'Artist B', 1)`)
	exec(t, `INSERT INTO genres (id, name, active) VALUES ('g-rock', 'Rock', 1), ('g-jazz', 'Jazz', 1)`)
	exec(t, `INSERT INTO songs (id, file_path, title, artist_id, album_id, genre, genre_id, year, mtime, checksum, duration, active) VALUES
		('s1', '/m/01.flac', 'Song One', 'ar-a', 'al-a', 'Rock', 'g-rock', 2020, 1, 'k1', 100, 1),
		('s2', '/m/02.flac', 'Song Two', 'ar-a', 'al-b', 'Jazz', 'g-jazz', 2021, 2, 'k2', 200, 1),
		('s3', '/m/03.flac', 'Song Three', 'ar-b', 'al-a', 'Rock', 'g-rock', 2020, 3, 'k3', 150, 1),
		('s4', '/m/04.flac', 'Song Four', 'ar-b', 'al-c', NULL, NULL, 2022, 4, 'k4', 120, 1),
		('s5', '/m/05.flac', 'Song Five', 'ar-a', 'al-a', 'Rock', 'g-rock', 2020, 5, 'k5', 100, 0)`)

	history := func(userID, songID, playedAt string, duration int) {
		t.Helper()
		exec(t, `INSERT INTO listening_history (id, user_id, song_id, played_at, duration_listened)
			VALUES (?, ?, ?, ?, ?)`, "h-"+userID+"-"+songID+"-"+playedAt, userID, songID, playedAt, duration)
	}
	// Alice: s1 ×5 → 3 in Aug, 2 in Sep.
	history("user-alice", "s1", "2026-08-05T10:00:00.000Z", 100)
	history("user-alice", "s1", "2026-08-12T10:00:00.000Z", 100)
	history("user-alice", "s1", "2026-08-19T10:00:00.000Z", 100)
	history("user-alice", "s1", "2026-09-02T10:00:00.000Z", 100)
	history("user-alice", "s1", "2026-09-10T10:00:00.000Z", 100)
	// Alice: s2 ×3, s3 ×2, all in Sep.
	history("user-alice", "s2", "2026-09-03T10:00:00.000Z", 200)
	history("user-alice", "s2", "2026-09-11T10:00:00.000Z", 200)
	history("user-alice", "s2", "2026-09-20T10:00:00.000Z", 200)
	history("user-alice", "s3", "2026-09-05T10:00:00.000Z", 150)
	history("user-alice", "s3", "2026-09-15T10:00:00.000Z", 150)
	// Alice played the inactive s5 — it must count nowhere.
	history("user-alice", "s5", "2026-09-08T10:00:00.000Z", 100)
	// Carol: s1 once in Sep.
	history("user-carol", "s1", "2026-09-09T10:00:00.000Z", 100)

	exec(t, `INSERT INTO user_songs (user_id, song_id, starred, rating, play_count) VALUES
		('user-alice', 's1', 1, 5, 5),
		('user-alice', 's2', 0, 4, 3),
		('user-alice', 's3', 0, 3, 2),
		('user-alice', 's4', 0, NULL, 0),
		('user-carol', 's1', 0, NULL, 1)`)
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

func decodeStats(t *testing.T, rec *httptest.ResponseRecorder) statistics.UserStatistics {
	t.Helper()
	var stats statistics.UserStatistics
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return stats
}

// ---------------------------------------------------------------------------
// Golden numbers
// ---------------------------------------------------------------------------

func TestUserStatisticsGoldenNumbers(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/statistics/me", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	stats := decodeStats(t, rec)

	if stats.UserID != "user-alice" || stats.Username != "alice" {
		t.Fatalf("identity: %+v", stats)
	}
	if stats.DisplayName == nil || *stats.DisplayName != "Alice A" {
		t.Fatalf("displayName: %+v", stats.DisplayName)
	}
	if stats.Range != statistics.RangeAll {
		t.Fatalf("range default: %q", stats.Range)
	}
	if stats.Totals.TotalPlays != 10 || stats.Totals.TotalDurationListened != 1400 {
		t.Fatalf("totals: %+v", stats.Totals)
	}
	if stats.Totals.FavoriteSongs != 1 || stats.Totals.FavoriteAlbums != 0 || stats.Totals.FavoriteArtists != 0 {
		t.Fatalf("favorites: %+v", stats.Totals)
	}

	// Top lists: exact order and counts.
	if len(stats.Top.TopSongs) != 3 ||
		stats.Top.TopSongs[0].SongID != "s1" || stats.Top.TopSongs[0].Plays != 5 ||
		stats.Top.TopSongs[0].ArtistName == nil || *stats.Top.TopSongs[0].ArtistName != "Artist A" ||
		stats.Top.TopSongs[1].SongID != "s2" || stats.Top.TopSongs[1].Plays != 3 ||
		stats.Top.TopSongs[2].SongID != "s3" || stats.Top.TopSongs[2].Plays != 2 {
		t.Fatalf("topSongs: %+v", stats.Top.TopSongs)
	}
	if len(stats.Top.TopArtists) != 2 ||
		stats.Top.TopArtists[0].ArtistName != "Artist A" || stats.Top.TopArtists[0].Plays != 8 ||
		stats.Top.TopArtists[1].ArtistName != "Artist B" || stats.Top.TopArtists[1].Plays != 2 {
		t.Fatalf("topArtists: %+v", stats.Top.TopArtists)
	}
	if len(stats.Top.TopAlbums) != 2 ||
		stats.Top.TopAlbums[0].AlbumName != "Album A" || stats.Top.TopAlbums[0].Plays != 7 ||
		stats.Top.TopAlbums[1].AlbumName != "Album B" || stats.Top.TopAlbums[1].Plays != 3 {
		t.Fatalf("topAlbums: %+v", stats.Top.TopAlbums)
	}
	if len(stats.Top.TopGenres) != 2 ||
		stats.Top.TopGenres[0].Genre != "Rock" || stats.Top.TopGenres[0].Plays != 7 ||
		stats.Top.TopGenres[0].TotalDurationListened != 800 ||
		stats.Top.TopGenres[1].Genre != "Jazz" || stats.Top.TopGenres[1].Plays != 3 ||
		stats.Top.TopGenres[1].TotalDurationListened != 600 {
		t.Fatalf("topGenres: %+v", stats.Top.TopGenres)
	}
	if len(stats.Top.TopYears) != 2 ||
		stats.Top.TopYears[0].Year != 2020 || stats.Top.TopYears[0].Plays != 7 ||
		stats.Top.TopYears[1].Year != 2021 || stats.Top.TopYears[1].Plays != 3 {
		t.Fatalf("topYears: %+v", stats.Top.TopYears)
	}

	// Bayesian rated lists: global average is (5+4+3)/3 = 4; prior 5.
	// Artist A: (9 + 5*4)/(2+5) = 29/7 = 4.14; Artist B has one rated song
	// and must fall under MIN_RATED_SONGS.
	if len(stats.Rated.TopRatedArtists) != 1 {
		t.Fatalf("topRatedArtists: %+v", stats.Rated.TopRatedArtists)
	}
	ra := stats.Rated.TopRatedArtists[0]
	if ra.ArtistName != "Artist A" || ra.AverageRating != 4.5 || ra.RatedSongs != 2 || ra.BayesianAverage != 4.14 {
		t.Fatalf("rated artist golden: %+v", ra)
	}
	if len(stats.Rated.TopRatedGenres) != 1 ||
		stats.Rated.TopRatedGenres[0].Genre != "Rock" ||
		stats.Rated.TopRatedGenres[0].AverageRating != 4 ||
		stats.Rated.TopRatedGenres[0].BayesianAverage != 4 {
		t.Fatalf("topRatedGenres: %+v", stats.Rated.TopRatedGenres)
	}
	if len(stats.Rated.TopRatedYears) != 1 ||
		stats.Rated.TopRatedYears[0].Year != 2020 ||
		stats.Rated.TopRatedYears[0].BayesianAverage != 4 {
		t.Fatalf("topRatedYears: %+v", stats.Rated.TopRatedYears)
	}

	// Rating distribution merges the three entity tables; unrated counts
	// alice's NULL-rated s4 row.
	dist := stats.Charts.RatingDistribution
	if dist.Unrated != 1 {
		t.Fatalf("unrated: %+v", dist)
	}
	wantCounts := map[int]int{1: 0, 2: 0, 3: 1, 4: 1, 5: 1}
	if len(dist.Ratings) != 5 {
		t.Fatalf("ratings buckets: %+v", dist.Ratings)
	}
	for _, bucket := range dist.Ratings {
		if bucket.Count != wantCounts[bucket.Rating] {
			t.Fatalf("bucket %d: want %d, got %+v", bucket.Rating, wantCounts[bucket.Rating], dist.Ratings)
		}
	}

	// Monthly plays: 3 in August, 7 in September.
	if len(stats.MonthlyPlays) != 2 ||
		stats.MonthlyPlays[0].Month != "2026-08" || stats.MonthlyPlays[0].Plays != 3 ||
		stats.MonthlyPlays[1].Month != "2026-09" || stats.MonthlyPlays[1].Plays != 7 {
		t.Fatalf("monthlyPlays: %+v", stats.MonthlyPlays)
	}
}

func TestUserStatisticsRange(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/statistics/me?range=30d", alice)
	stats := decodeStats(t, rec)
	if stats.Range != statistics.Range30d {
		t.Fatalf("range: %q", stats.Range)
	}
	// Only the September plays fall inside 30 days: 7 plays, 1100 seconds.
	if stats.Totals.TotalPlays != 7 || stats.Totals.TotalDurationListened != 1100 {
		t.Fatalf("30d totals: %+v", stats.Totals)
	}
	// s2 leads inside the window (3 plays).
	if len(stats.Top.TopSongs) == 0 || stats.Top.TopSongs[0].SongID != "s2" {
		t.Fatalf("30d topSongs: %+v", stats.Top.TopSongs)
	}
	// Invalid ranges fall back to all, like the retired server.
	rec = s.do(t, http.MethodGet, "/api/statistics/me?range=bogus", alice)
	if stats := decodeStats(t, rec); stats.Range != statistics.RangeAll || stats.Totals.TotalPlays != 10 {
		t.Fatalf("invalid range fallback: %+v", stats)
	}
}

func TestOverallStatisticsGoldenNumbers(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	rec := s.do(t, http.MethodGet, "/api/statistics/overall", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var stats statistics.OverallStatistics
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if stats.Totals.TotalPlays != 11 || stats.Totals.TotalDurationListened != 1500 {
		t.Fatalf("overall totals: %+v", stats.Totals)
	}
	if len(stats.Top.TopSongs) == 0 || stats.Top.TopSongs[0].SongID != "s1" || stats.Top.TopSongs[0].Plays != 6 {
		t.Fatalf("overall topSongs: %+v", stats.Top.TopSongs)
	}
	if len(stats.UserSummaries) != 2 ||
		stats.UserSummaries[0].UserID != "user-alice" ||
		stats.UserSummaries[0].TotalPlays != 10 ||
		stats.UserSummaries[0].TotalDurationListened != 1400 ||
		stats.UserSummaries[0].UniqueSongs != 3 ||
		stats.UserSummaries[1].UserID != "user-carol" ||
		stats.UserSummaries[1].TotalPlays != 1 ||
		stats.UserSummaries[1].UniqueSongs != 1 {
		t.Fatalf("userSummaries: %+v", stats.UserSummaries)
	}
}

func TestMonthlyGroupedGoldenNumbers(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)

	rec := s.do(t, http.MethodGet, "/api/statistics/me/monthly-grouped?groupBy=artist", alice)
	var payload struct {
		Data []statistics.MonthlyGroupedItem `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	want := []statistics.MonthlyGroupedItem{
		{Month: "2026-08", Groups: []statistics.GroupItem{{Key: "Artist A", Plays: 3}}},
		{Month: "2026-09", Groups: []statistics.GroupItem{{Key: "Artist A", Plays: 5}, {Key: "Artist B", Plays: 2}}},
	}
	assertGroupedEqual(t, payload.Data, want)

	rec = s.do(t, http.MethodGet, "/api/statistics/me/monthly-grouped?groupBy=rating", alice)
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Rating keys are the ratings cast to text (wire parity: REAL columns cast
	// as '5.0', half-ratings as '4.5').
	want = []statistics.MonthlyGroupedItem{
		{Month: "2026-08", Groups: []statistics.GroupItem{{Key: "5.0", Plays: 3}}},
		{Month: "2026-09", Groups: []statistics.GroupItem{
			{Key: "4.0", Plays: 3}, {Key: "3.0", Plays: 2}, {Key: "5.0", Plays: 2},
		}},
	}
	assertGroupedEqual(t, payload.Data, want)

	rec = s.do(t, http.MethodGet, "/api/statistics/me/monthly-grouped?groupBy=favorite", alice)
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want = []statistics.MonthlyGroupedItem{
		{Month: "2026-08", Groups: []statistics.GroupItem{{Key: "Favorite", Plays: 3}}},
		{Month: "2026-09", Groups: []statistics.GroupItem{
			{Key: "Not favorite", Plays: 5}, {Key: "Favorite", Plays: 2},
		}},
	}
	assertGroupedEqual(t, payload.Data, want)

	if rec := s.do(t, http.MethodGet, "/api/statistics/me/monthly-grouped?groupBy=bogus", alice); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid groupBy: want 400, got %d", rec.Code)
	}
}

func assertGroupedEqual(t *testing.T, got, want []statistics.MonthlyGroupedItem) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("grouped: got %+v want %+v", got, want)
	}
	for i := range want {
		if got[i].Month != want[i].Month || len(got[i].Groups) != len(want[i].Groups) {
			t.Fatalf("grouped[%d]: got %+v want %+v", i, got[i], want[i])
		}
		for j := range want[i].Groups {
			if got[i].Groups[j] != want[i].Groups[j] {
				t.Fatalf("grouped[%d].Groups[%d]: got %+v want %+v", i, j, got[i].Groups[j], want[i].Groups[j])
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Authorization matrix
// ---------------------------------------------------------------------------

func TestAuthzMatrix(t *testing.T) {
	s := newSeededServer(t)
	anon := (*http.Cookie)(nil)
	alice := s.session(t, "user-alice", "alice", false)
	carol := s.session(t, "user-carol", "carol", false)
	admin := s.session(t, "user-admin", "root", true)

	cases := []struct {
		path      string
		anonCode  int
		aliceCode int
		carolCode int
		adminCode int
	}{
		{"/api/statistics/me", 401, 200, 200, 200},
		{"/api/statistics/me/monthly-grouped?groupBy=artist", 401, 200, 200, 200},
		{"/api/statistics/overall", 401, 403, 403, 200},
		{"/api/statistics/users/user-alice", 401, 403, 403, 200},
		{"/api/statistics/users/user-alice/monthly-grouped?groupBy=genre", 401, 403, 403, 200},
	}
	for _, tc := range cases {
		if rec := s.do(t, http.MethodGet, tc.path, anon); rec.Code != tc.anonCode {
			t.Errorf("%s anon: want %d, got %d", tc.path, tc.anonCode, rec.Code)
		}
		if rec := s.do(t, http.MethodGet, tc.path, alice); rec.Code != tc.aliceCode {
			t.Errorf("%s alice: want %d, got %d", tc.path, tc.aliceCode, rec.Code)
		}
		if rec := s.do(t, http.MethodGet, tc.path, carol); rec.Code != tc.carolCode {
			t.Errorf("%s carol: want %d, got %d", tc.path, tc.carolCode, rec.Code)
		}
		if rec := s.do(t, http.MethodGet, tc.path, admin); rec.Code != tc.adminCode {
			t.Errorf("%s admin: want %d, got %d", tc.path, tc.adminCode, rec.Code)
		}
	}
}

func TestUserStatisticsUnknownUserIs404(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	rec := s.do(t, http.MethodGet, "/api/statistics/users/user-nope", admin)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["error"] != "Not found" {
		t.Fatalf("typed error contract: %+v", body)
	}
}

func TestStatisticsErrorContractNeverLeaksDriverMessages(t *testing.T) {
	// A vanished songs table turns every query into a driver error; the
	// response must stay a generic 500.
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	s := newServer(t, database)
	s.mustExec(t, `INSERT INTO users (id, username, password_hash) VALUES ('user-alice', 'alice', 'x')`)
	s.mustExec(t, `DROP TABLE songs`)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/statistics/me", alice)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["error"] != "Internal Server Error" {
		t.Fatalf("generic error contract: %+v", body)
	}
}

// ---------------------------------------------------------------------------
// Query-count guard: the retired server ran ~20 statements per statistics request; the Go server must
// stay flat at six (user row, totals+favorites, top lists, rated lists,
// distribution, monthly plays) no matter how much history exists.
// ---------------------------------------------------------------------------

var (
	countingOnce    sync.Once
	countingCounter atomic.Int64
)

type countingDriver struct{ base driver.Driver }

func (d *countingDriver) Open(name string) (driver.Conn, error) {
	c, err := d.base.Open(name)
	if err != nil {
		return nil, err
	}
	return &countingConn{Conn: c}, nil
}

type countingConn struct{ driver.Conn }

func (c *countingConn) Prepare(query string) (driver.Stmt, error) {
	countingCounter.Add(1)
	return c.Conn.Prepare(query)
}

func (c *countingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if q, ok := c.Conn.(driver.QueryerContext); ok {
		countingCounter.Add(1)
		return q.QueryContext(ctx, query, args)
	}
	return nil, driver.ErrSkip
}

func (c *countingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if e, ok := c.Conn.(driver.ExecerContext); ok {
		countingCounter.Add(1)
		return e.ExecContext(ctx, query, args)
	}
	return nil, driver.ErrSkip
}

func openCountingDB(t *testing.T) *sql.DB {
	t.Helper()
	countingOnce.Do(func() {
		sql.Register("sqlite-statcount", &countingDriver{base: &sqlite.Driver{}})
	})
	countingCounter.Store(0)
	dsn := "file::memory:?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=mmap_size(268435456)"
	database, err := sql.Open("sqlite-statcount", dsn)
	if err != nil {
		t.Fatalf("open counting db: %v", err)
	}
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)
	if err := database.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if err := db.Migrate(context.Background(), database); err != nil {
		database.Close()
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func TestQueryCountBudget(t *testing.T) {
	database := openCountingDB(t)
	s := newServer(t, database)
	s.seed(t)

	// Inject the identity directly: session minting would count against the
	// budget, and the measurement targets the request only.
	countingCounter.Store(0)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/statistics/me", nil)
	req = req.WithContext(auth.WithIdentity(req.Context(), auth.Identity{UserID: "user-alice"}))
	s.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	queries := countingCounter.Load()
	t.Logf("/api/statistics/me ran %d statements (old: ~20)", queries)
	if queries > 6 {
		t.Fatalf("statistics/me must run at most 6 statements, ran %d", queries)
	}

	countingCounter.Store(0)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/statistics/overall", nil)
	req = req.WithContext(auth.WithIdentity(req.Context(), auth.Identity{UserID: "user-admin", IsAdmin: true}))
	s.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	queries = countingCounter.Load()
	// Six service statements plus RequireAdmin's one admin-flag re-read —
	// the database-backed admin gate is part of the route, not the service.
	t.Logf("/api/statistics/overall ran %d statements (old: ~20)", queries)
	if queries > 7 {
		t.Fatalf("statistics/overall must run at most 7 statements, ran %d", queries)
	}
}

// Legacy databases store duration_listened as fractional REAL (the retired
// server wrote raw JS floats), so SUM aggregates arrive as float64 - the
// statistics scans must tolerate them (incident: /statistics/overall 500'd
// on the production database with "converting driver.Value type float64").
func TestStatisticsToleratesLegacyFractionalDurations(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	alice := s.session(t, "user-alice", "alice", false)

	s.db.Exec(`INSERT INTO listening_history (id, user_id, song_id, played_at, duration_listened, completion)
		VALUES
		('lh-f1', 'user-alice', 's1', '2026-09-20T10:00:00.000Z', 193.481212345, 0.95),
		('lh-f2', 'user-alice', 's2', '2026-09-21T10:00:00.000Z', 61.5, 0.5),
		('lh-f3', 'user-bob', 's1', '2026-09-20T11:00:00.000Z', 44.25, 1.0)`)

	rec := s.do(t, http.MethodGet, "/api/statistics/me", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("me with fractional durations: %d %s", rec.Code, rec.Body.String())
	}
	rec = s.do(t, http.MethodGet, "/api/statistics/overall", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("overall with fractional durations: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "totalDurationListened") {
		t.Fatalf("overall summaries missing durations: %.200s", rec.Body.String())
	}
}
