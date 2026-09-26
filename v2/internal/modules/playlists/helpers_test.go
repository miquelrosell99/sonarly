package playlists

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"

	"github.com/miquelrosell99/sonarly/v2/internal/config"
	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

const testSecret = "0123456789abcdef0123456789abcdef"

// testEnv boots the full production chain (httpserver middleware, real
// session auth, playlists routes) over a seeded in-memory database.
type testEnv struct {
	db     *sql.DB
	store  *auth.Store
	svc    *Service
	policy *Policy
	srv    *httptest.Server
	client *http.Client
}

// newEnv seeds the standard fixture:
//
//	users:  u-owner (lib-a)  u-viewer (lib-a)  u-outsider (lib-b)
//	        u-nolib (none)   u-admin (admin, all libraries)
//	songs:  s-a1 lib-a Alpha/A1 100% Pure (genre Rock + secondary Jazz)
//	        s-a2 lib-a Alpha/A1 Second Song
//	        s-b1 lib-b Beta/B1  Beta Song
//	        s-b2 lib-b Beta/B1  Another Beta
//	        s-inactive lib-a (active = 0)
//	        s-nolib NULL library
//	playlists: pl-private   owner private [s-a1, s-a2]
//	           pl-public    owner public  [s-a1, s-b1]   (cross-library)
//	           pl-link      owner link    [s-a1]  token tok-link
//	           pl-shared-v  owner private shared with u-viewer (view)
//	           pl-shared-e  owner private shared with u-viewer (edit)
//	           pl-smart     owner smart link  token tok-smart
//	                        rules: title contains "a", sort title asc
//	           pl-foreign   u-outsider private [s-b1]
func newEnv(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()
	database, err := db.OpenInMemory(ctx)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	policy := NewPolicy()
	svc := NewService(database, policy)
	mw := auth.NewMiddleware(auth.NewStore(database), database, testSecret, false)
	handler := httpserver.New(config.Config{}, log)
	NewHandler(svc, mw).Routes(handler.Router())
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	env := &testEnv{
		db:     database,
		store:  auth.NewStore(database),
		svc:    svc,
		policy: policy,
		srv:    srv,
		client: &http.Client{Jar: jar},
	}
	env.seed(t)
	return env
}

// cookie mints a real session row and returns the signed cookie, so requests
// traverse the genuine AuthMiddleware → RequireAuth chain.
func (e *testEnv) cookie(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
	t.Helper()
	sid := auth.NewSID()
	if err := e.store.Create(context.Background(), sid, auth.Session{
		UserID: userID, Username: username, IsAdmin: isAdmin,
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, testSecret, false, sid)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one session cookie, got %d", len(cookies))
	}
	return cookies[0]
}

// do performs one request against the test server. body may be nil, a
// string, or []byte.
func (e *testEnv) do(t *testing.T, method, path string, cookie *http.Cookie, body any) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		switch b := body.(type) {
		case string:
			reader = bytes.NewReader([]byte(b))
		case []byte:
			reader = bytes.NewReader(b)
		default:
			t.Fatalf("unsupported body type %T", body)
		}
	}
	req, err := http.NewRequest(method, e.srv.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := e.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	return res, data
}

func (e *testEnv) mustExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := e.db.Exec(query, args...); err != nil {
		t.Fatalf("fixture exec: %v\n%s", err, query)
	}
}

func (e *testEnv) seed(t *testing.T) {
	t.Helper()
	exec := e.mustExec

	exec(t, `INSERT INTO users (id, username, password_hash, is_admin, hide_explicit) VALUES
		('u-owner',    'owner',    'x', 0, 0),
		('u-viewer',   'viewer',   'x', 0, 0),
		('u-outsider', 'outsider', 'x', 0, 0),
		('u-nolib',    'nolib',    'x', 0, 0),
		('u-admin',    'root',     'x', 1, 0)`)
	exec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', '/music/a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
		('lib-b', 'Library B', '/music/b', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	exec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES
		('u-owner', 'lib-a'), ('u-viewer', 'lib-a'), ('u-outsider', 'lib-b')`)

	exec(t, `INSERT INTO artists (id, name, active) VALUES
		('ar-alpha', 'Alpha', 1), ('ar-beta', 'Beta', 1)`)
	exec(t, `INSERT INTO genres (id, name, active) VALUES
		('g-rock', 'Rock', 1), ('g-jazz', 'Jazz', 1), ('g-pop', 'Pop', 1)`)
	exec(t, `INSERT INTO cover_arts (id, format, data, hash) VALUES
		('ca-a1', 'jpg', x'00', 'h-a1'), ('ca-b1', 'jpg', x'00', 'h-b1'),
		('ca-sa1', 'jpg', x'00', 'h-sa1')`)
	exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, active, release_type, cover_art_id) VALUES
		('al-a1', 'A1', 'ar-alpha', 'Alpha', 1, 'album', 'ca-a1'),
		('al-b1', 'B1', 'ar-beta', 'Beta', 1, 'single', 'ca-b1')`)

	songs := []struct {
		id, title            string
		artist, album, genre any
		track, year, dur     int
		bitDepth             int
		active               int
		library              any
		cover                any
	}{
		{"s-a1", "100% Pure", "ar-alpha", "al-a1", "g-rock", 1, 1999, 300, 16, 1, "lib-a", "ca-sa1"},
		{"s-a2", "Second Song", "ar-alpha", "al-a1", "g-rock", 2, 2001, 200, 16, 1, "lib-a", nil},
		{"s-b1", "Beta Song", "ar-beta", "al-b1", "g-pop", 1, 2010, 250, 24, 1, "lib-b", nil},
		{"s-b2", "Another Beta", "ar-beta", "al-b1", "g-jazz", 2, 2011, 210, 24, 1, "lib-b", nil},
		{"s-inactive", "Ghost", nil, nil, nil, 0, 0, 0, 0, 0, "lib-a", nil},
		{"s-nolib", "NoLib", nil, nil, nil, 0, 1980, 100, 0, 1, nil, nil},
	}
	for _, s := range songs {
		exec(t, `INSERT INTO songs (id, file_path, title, track_number, year, duration,
				bits_per_sample, mtime, checksum, active, artist_id, album_id, genre_id, library_id, cover_art_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, 1700000000000, ?, ?, ?, ?, ?, ?, ?)`,
			s.id, "/music/"+s.id+".flac", s.title, s.track, s.year, s.dur,
			s.bitDepth, "k-"+s.id, s.active, s.artist, s.album, s.genre, s.library, s.cover)
	}
	// Junction data: s-a1 is Rock with Jazz as SECONDARY genre (the
	// compiler must match it via the junction, not songs.genre_id).
	exec(t, `INSERT INTO song_genres (song_id, genre_id, position) VALUES
		('s-a1', 'g-rock', 0), ('s-a1', 'g-jazz', 1),
		('s-a2', 'g-rock', 0), ('s-b1', 'g-pop', 0), ('s-b2', 'g-jazz', 0)`)
	exec(t, `INSERT INTO song_artists (song_id, artist_id, position) VALUES
		('s-a1', 'ar-alpha', 0), ('s-a2', 'ar-alpha', 0),
		('s-b1', 'ar-beta', 0), ('s-b2', 'ar-beta', 0)`)

	// Owner interactions: user-scoped rule fields resolve against these.
	exec(t, `INSERT INTO user_songs (user_id, song_id, starred, rating, play_count, last_played) VALUES
		('u-owner', 's-a1', 1, 5, 10, '2026-09-20T10:00:00Z'),
		('u-owner', 's-a2', 0, 3, 2,  '2026-01-01T10:00:00Z'),
		('u-viewer', 's-a1', 0, 1, 1, '2026-09-01T10:00:00Z'),
		('u-viewer', 's-a2', 1, 5, 99, '2026-09-24T10:00:00Z')`)

	exec(t, `INSERT INTO playlists (id, name, owner_id, visibility, share_token, is_smart, rules_json, resolve_mode) VALUES
		('pl-private', 'Private', 'u-owner', 'private', NULL, 0, NULL, 'tracks'),
		('pl-public',  'Public',  'u-owner', 'public',  NULL, 0, NULL, 'tracks'),
		('pl-link',    'Linked',  'u-owner', 'link',    'tok-link', 0, NULL, 'tracks'),
		('pl-shared-v','SharedV', 'u-owner', 'private', NULL, 0, NULL, 'tracks'),
		('pl-shared-e','SharedE', 'u-owner', 'private', NULL, 0, NULL, 'tracks'),
		('pl-smart',   'Smart',   'u-owner', 'link',    'tok-smart', 1,
			'{"rules":{"all":[{"field":"title","operator":"contains","value":"a"}]},"sort":[{"field":"title","direction":"asc"}]}', 'tracks'),
		('pl-foreign', 'Foreign', 'u-outsider', 'private', NULL, 0, NULL, 'tracks')`)
	exec(t, `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES
		('pl-private', 's-a1', 0), ('pl-private', 's-a2', 1),
		('pl-public', 's-a1', 0), ('pl-public', 's-b1', 1),
		('pl-link', 's-a1', 0),
		('pl-shared-v', 's-a1', 0),
		('pl-shared-e', 's-a2', 0),
		('pl-foreign', 's-b1', 0)`)
	exec(t, `INSERT INTO playlist_shares (playlist_id, user_id, can_edit) VALUES
		('pl-shared-v', 'u-viewer', 0),
		('pl-shared-e', 'u-viewer', 1)`)
}

// decodeDetail parses a {"playlist": ...} response body.
func decodeDetail(t *testing.T, body []byte) Detail {
	t.Helper()
	var out struct {
		Playlist Detail `json:"playlist"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode detail: %v\n%s", err, body)
	}
	return out.Playlist
}

// decodeList parses a {"playlists": [...]} response body.
func decodeList(t *testing.T, body []byte) []ListItem {
	t.Helper()
	var out struct {
		Playlists []ListItem `json:"playlists"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode list: %v\n%s", err, body)
	}
	return out.Playlists
}
