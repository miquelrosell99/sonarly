package catalog_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// injectIdentity wraps a handler with a fixed authenticated identity, so the
// N+1 guard counts catalog statements only — no session-store lookup skews
// the measurement. Scope resolution itself still runs (for admins it issues
// no query; that constant would not affect the per-row scaling under test
// anyway).
func injectIdentity(next http.Handler, id auth.Identity) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(auth.WithIdentity(r.Context(), id)))
	})
}

func adminIdentity() auth.Identity {
	return auth.Identity{UserID: "user-admin", Username: "root", IsAdmin: true}
}

// seedBigCatalog creates one album with albumSongs tracks plus standaloneSongs
// more songs (all lib-a, one shared artist with a junction row per song).
func seedBigCatalog(t *testing.T, s *server, albumSongs, standaloneSongs int) {
	t.Helper()
	s.mustExec(t, `INSERT INTO users (id, username, password_hash, is_admin) VALUES
		('user-admin', 'root', 'x', 1),
		('user-alice', 'alice', 'x', 0)`)
	s.mustExec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', '/music/a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	s.mustExec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES ('user-alice', 'lib-a')`)
	s.mustExec(t, `INSERT INTO artists (id, name, active) VALUES ('ar-big', 'Big', 1)`)
	s.mustExec(t, `INSERT INTO albums (id, name, artist_id, artist_name, active) VALUES
		('al-big', 'Big Album', 'ar-big', 'Big', 1)`)

	insertSong := func(id string, album bool, track int) {
		var albumID any
		if album {
			albumID = "al-big"
		}
		s.mustExec(t,
			`INSERT INTO songs (id, file_path, title, track_number, mtime, checksum, artist_id, album_id, active, library_id)
			VALUES (?, ?, ?, ?, 1, ?, 'ar-big', ?, 1, 'lib-a')`,
			id, "/music/a/"+id+".flac", "Song "+id, track, "k-"+id, albumID)
		s.mustExec(t, `INSERT INTO song_artists (song_id, artist_id, position) VALUES (?, 'ar-big', 0)`, id)
	}
	for i := 1; i <= albumSongs; i++ {
		insertSong(fmt.Sprintf("s-b%03d", i), true, i)
	}
	for i := 1; i <= standaloneSongs; i++ {
		insertSong(fmt.Sprintf("s-x%03d", i), false, 0)
	}
}

// TestQueryCountsAlbumDetail is the N+1 guard for the album detail page:
// an album with 25 songs must answer in a bounded number of statements,
// independent of the song count (v1's batch pattern, kept flat in v2).
func TestQueryCountsAlbumDetail(t *testing.T) {
	database, count := openCountingDB(t)
	s := newServer(t, database)
	seedBigCatalog(t, s, 25, 0)
	router := injectIdentity(s.router, adminIdentity())

	count.Reset()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/albums/al-big", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if n := len(body["songs"].([]any)); n != 25 {
		t.Fatalf("want 25 songs, got %d", n)
	}
	queries := count.Load()
	t.Logf("albums/{id} with 25 songs: %d queries", queries)
	if queries > 6 {
		t.Errorf("album detail must run <= 6 queries, ran %d", queries)
	}
}

// TestQueryCountsSongsList is the N+1 guard for the song list: 50 songs must
// not trigger per-song statements.
func TestQueryCountsSongsList(t *testing.T) {
	database, count := openCountingDB(t)
	s := newServer(t, database)
	seedBigCatalog(t, s, 0, 50)
	router := injectIdentity(s.router, adminIdentity())

	count.Reset()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/songs", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if n := len(body["songs"].([]any)); n != 50 {
		t.Fatalf("want 50 songs, got %d", n)
	}
	queries := count.Load()
	t.Logf("songs list of 50: %d queries", queries)
	if queries > 5 {
		t.Errorf("songs list must run <= 5 queries, ran %d", queries)
	}
}

// TestQueryCountsChunking crosses the 400-id chunk boundary of the batch
// loaders: 450 songs force two IN queries per relation, and every chunk must
// merge back so no song loses its attached artists.
func TestQueryCountsChunking(t *testing.T) {
	database, count := openCountingDB(t)
	s := newServer(t, database)
	seedBigCatalog(t, s, 450, 0)
	router := injectIdentity(s.router, adminIdentity())

	count.Reset()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/songs", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	songs := body["songs"].([]any)
	if len(songs) != 450 {
		t.Fatalf("want 450 songs, got %d", len(songs))
	}
	missing := 0
	for _, item := range songs {
		song := item.(map[string]any)
		if _, ok := song["artists"]; !ok {
			missing++
		}
	}
	if missing != 0 {
		t.Errorf("%d songs lost their batch-attached artists across chunks", missing)
	}
	queries := count.Load()
	t.Logf("songs list of 450 (chunked): %d queries", queries)
	// 1 list + 3 relations x 2 chunks = 7.
	if queries > 8 {
		t.Errorf("chunked songs list must run <= 8 queries, ran %d", queries)
	}
}

// TestQueryCountsScopedUser documents the per-request constant a scoped user
// adds (scope resolution + one policy probe) on top of the flat list query
// count — still independent of the number of songs.
func TestQueryCountsScopedUser(t *testing.T) {
	database, count := openCountingDB(t)
	s := newServer(t, database)
	seedBigCatalog(t, s, 0, 50)
	router := injectIdentity(s.router, auth.Identity{UserID: "user-alice", Username: "alice"})

	count.Reset()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/songs", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	queries := count.Load()
	t.Logf("scoped-user songs list of 50: %d queries", queries)
	if queries > 7 {
		t.Errorf("scoped songs list must run <= 7 queries (4 + scope + flat), ran %d", queries)
	}
}
