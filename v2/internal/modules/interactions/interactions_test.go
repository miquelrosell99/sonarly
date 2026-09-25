package interactions_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/interactions"
)

const (
	secret = "0123456789abcdef0123456789abcdef"
	userID = "user-1"
)

type testServer struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
}

func newTestServer(t *testing.T) *testServer {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, secret, false)
	handler := interactions.NewHandler(interactions.NewService(database), mw)
	r := chi.NewRouter()
	handler.Routes(r)
	return &testServer{db: database, store: store, router: r}
}

func (s *testServer) seedUser(t *testing.T, id, username string) {
	t.Helper()
	_, err := s.db.Exec(
		`INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, 'x', 0, '2026-01-01T00:00:00.000Z')`,
		id, username)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

// seedEntities inserts one song/album/artist row each so the junction FK
// constraints are satisfiable (the junction tables reference real rows,
// exactly like v1's schema).
func (s *testServer) seedEntities(t *testing.T) {
	t.Helper()
	s.exec(t, `INSERT INTO artists (id, name) VALUES ('e-1', 'Artist')`)
	s.exec(t, `INSERT INTO albums (id, name) VALUES ('e-1', 'Album')`)
	s.exec(t, `INSERT INTO songs (id, title, file_path, mtime, checksum, active)
		VALUES ('e-1', 'Song', '/e-1.mp3', 0, 'sum', 1)`)
}

func (s *testServer) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatalf("exec: %v", err)
	}
}

func (s *testServer) cookie(t *testing.T, id, username string) *http.Cookie {
	t.Helper()
	if err := s.store.Create(context.Background(), "sid-"+id, auth.Session{UserID: id, Username: username}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, secret, false, "sid-"+id)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("no cookie written")
	}
	return cookies[0]
}

func (s *testServer) do(t *testing.T, method, path string, body any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func errorMessage(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var out struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode error body: %v (%s)", err, rec.Body.String())
	}
	return out.Error
}

func TestFavoritesJunctionWrites(t *testing.T) {
	s := newTestServer(t)
	s.seedUser(t, userID, "alice")
	s.seedEntities(t)
	ck := s.cookie(t, userID, "alice")

	cases := []struct {
		key   string
		table string
		col   string
	}{
		{"songId", "user_songs", "song_id"},
		{"albumId", "user_albums", "album_id"},
		{"artistId", "user_artists", "artist_id"},
	}
	for _, tc := range cases {
		t.Run(tc.table, func(t *testing.T) {
			rec := s.do(t, http.MethodPost, "/api/favorites", map[string]any{tc.key: "e-1", "starred": true}, ck)
			if rec.Code != http.StatusOK {
				t.Fatalf("favorites: %d %s", rec.Code, rec.Body.String())
			}
			var starred int
			err := s.db.QueryRow(`SELECT starred FROM `+tc.table+` WHERE user_id = ? AND `+tc.col+` = ?`,
				userID, "e-1").Scan(&starred)
			if err != nil {
				t.Fatal(err)
			}
			if starred != 1 {
				t.Fatalf("starred = %d", starred)
			}

			// starred:false unstars (round trip on the same row).
			rec = s.do(t, http.MethodPost, "/api/favorites", map[string]any{tc.key: "e-1", "starred": false}, ck)
			if rec.Code != http.StatusOK {
				t.Fatalf("unfavorite: %d", rec.Code)
			}
			if err := s.db.QueryRow(`SELECT starred FROM `+tc.table+` WHERE user_id = ? AND `+tc.col+` = ?`,
				userID, "e-1").Scan(&starred); err != nil {
				t.Fatal(err)
			}
			if starred != 0 {
				t.Fatalf("starred after unfavorite = %d", starred)
			}
		})
	}
}

func TestFavoritesStarredDefaultsTrue(t *testing.T) {
	s := newTestServer(t)
	s.seedUser(t, userID, "alice")
	s.seedEntities(t)
	ck := s.cookie(t, userID, "alice")

	rec := s.do(t, http.MethodPost, "/api/favorites", map[string]any{"songId": "e-1"}, ck)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	var starred int
	if err := s.db.QueryRow(`SELECT starred FROM user_songs WHERE user_id = ? AND song_id = ?`,
		userID, "e-1").Scan(&starred); err != nil {
		t.Fatal(err)
	}
	if starred != 1 {
		t.Fatalf("absent starred must default to true, got %d", starred)
	}
}

func TestFavoritesValidation(t *testing.T) {
	s := newTestServer(t)
	s.seedUser(t, userID, "alice")
	s.seedEntities(t)
	ck := s.cookie(t, userID, "alice")

	cases := []struct {
		name string
		body map[string]any
	}{
		{"no id", map[string]any{"starred": true}},
		{"two ids", map[string]any{"songId": "e-1", "albumId": "e-2"}},
		{"three ids", map[string]any{"songId": "e-1", "albumId": "e-2", "artistId": "e-3"}},
		{"non-bool starred", map[string]any{"songId": "e-1", "starred": "yes"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := s.do(t, http.MethodPost, "/api/favorites", tc.body, ck)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d", rec.Code)
			}
		})
	}

	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM user_songs WHERE user_id = ?`, userID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("invalid favorites must write nothing (%d rows)", n)
	}
}

func TestRatingsHalfSteps(t *testing.T) {
	s := newTestServer(t)
	s.seedUser(t, userID, "alice")
	s.seedEntities(t)
	ck := s.cookie(t, userID, "alice")

	// 0.5 steps across the range, including the extremes.
	for _, r := range []float64{0, 0.5, 3, 3.5, 5} {
		rec := s.do(t, http.MethodPost, "/api/ratings", map[string]any{"songId": "e-1", "rating": r}, ck)
		if rec.Code != http.StatusOK {
			t.Fatalf("rating %v: %d %s", r, rec.Code, rec.Body.String())
		}
		var stored float64
		if err := s.db.QueryRow(`SELECT rating FROM user_songs WHERE user_id = ? AND song_id = ?`,
			userID, "e-1").Scan(&stored); err != nil {
			t.Fatal(err)
		}
		if stored != r {
			t.Fatalf("stored %v, want %v", stored, r)
		}
	}

	// Off-step and out-of-range ratings are rejected.
	for _, r := range []float64{-0.5, 4.25, 5.5, 0.1} {
		rec := s.do(t, http.MethodPost, "/api/ratings", map[string]any{"songId": "e-1", "rating": r}, ck)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("rating %v: want 400, got %d", r, rec.Code)
		}
	}

	// Non-numeric ratings are rejected by decoding.
	rec := s.do(t, http.MethodPost, "/api/ratings", map[string]any{"songId": "e-1", "rating": "4.5"}, ck)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("string rating: want 400, got %d", rec.Code)
	}

	// null clears.
	rec = s.do(t, http.MethodPost, "/api/ratings", map[string]any{"songId": "e-1", "rating": nil}, ck)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear: %d", rec.Code)
	}
	var cleared sql.NullFloat64
	if err := s.db.QueryRow(`SELECT rating FROM user_songs WHERE user_id = ? AND song_id = ?`,
		userID, "e-1").Scan(&cleared); err != nil {
		t.Fatal(err)
	}
	if cleared.Valid {
		t.Fatalf("rating must be NULL after clearing, got %v", cleared.Float64)
	}
}

func TestRatingsRecomputeSongAverage(t *testing.T) {
	s := newTestServer(t)
	s.seedUser(t, userID, "alice")
	s.seedEntities(t)
	ck := s.cookie(t, userID, "alice")

	s.do(t, http.MethodPost, "/api/ratings", map[string]any{"songId": "e-1", "rating": 4.5}, ck)
	var avg sql.NullFloat64
	if err := s.db.QueryRow(`SELECT average_rating FROM songs WHERE id = 'e-1'`).Scan(&avg); err != nil {
		t.Fatal(err)
	}
	if !avg.Valid || avg.Float64 != 4.5 {
		t.Fatalf("average = %v", avg)
	}

	// Clearing the only rating recomputes to NULL.
	s.do(t, http.MethodPost, "/api/ratings", map[string]any{"songId": "e-1", "rating": nil}, ck)
	if err := s.db.QueryRow(`SELECT average_rating FROM songs WHERE id = 'e-1'`).Scan(&avg); err != nil {
		t.Fatal(err)
	}
	if avg.Valid {
		t.Fatalf("average after clear = %v, want NULL", avg.Float64)
	}

	// Album/artist ratings write their junctions without touching songs.
	rec := s.do(t, http.MethodPost, "/api/ratings", map[string]any{"albumId": "e-1", "rating": 2.5}, ck)
	if rec.Code != http.StatusOK {
		t.Fatalf("album rating: %d", rec.Code)
	}
	var albumRating float64
	if err := s.db.QueryRow(`SELECT rating FROM user_albums WHERE user_id = ? AND album_id = 'e-1'`,
		userID).Scan(&albumRating); err != nil {
		t.Fatal(err)
	}
	if albumRating != 2.5 {
		t.Fatalf("album rating = %v", albumRating)
	}
}

func TestRatingsValidation(t *testing.T) {
	s := newTestServer(t)
	s.seedUser(t, userID, "alice")
	s.seedEntities(t)
	ck := s.cookie(t, userID, "alice")

	rec := s.do(t, http.MethodPost, "/api/ratings", map[string]any{"rating": 4}, ck)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("no id: want 400, got %d", rec.Code)
	}
	rec = s.do(t, http.MethodPost, "/api/ratings", map[string]any{"songId": "e", "albumId": "e2", "rating": 4}, ck)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("two ids: want 400, got %d", rec.Code)
	}
}

func TestInteractionsRequireAuth(t *testing.T) {
	s := newTestServer(t)
	s.seedUser(t, userID, "alice")

	for _, path := range []string{"/api/favorites", "/api/ratings"} {
		rec := s.do(t, http.MethodPost, path, map[string]any{"songId": "e-1"})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s anonymous: want 401, got %d", path, rec.Code)
		}
	}
	_ = errorMessage
}
