package players_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playback"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/players"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type server struct {
	db      *sql.DB
	store   *auth.Store
	tracker *players.Tracker
	router  http.Handler
}

func newServer(t *testing.T, database *sql.DB) *server {
	t.Helper()
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	tracker := players.NewTracker()
	playbackService := playback.NewService(database, playback.Options{
		MaxConcurrentTranscodes: 1,
		FFmpegPath:              "ffmpeg",
	}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	playbackService.SetRecorder(tracker)
	r := chi.NewRouter()
	playback.NewHandler(playbackService, mw).Routes(r)
	players.NewHandler(tracker, database, mw).Routes(r)
	return &server{db: database, store: store, tracker: tracker, router: r}
}

func (s *server) do(t *testing.T, method, path, userAgent, clientParam string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	if clientParam != "" {
		path += "?c=" + clientParam
	}
	req := httptest.NewRequest(method, path, nil)
	if userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func (s *server) session(t *testing.T, userID, username string) *http.Cookie {
	t.Helper()
	sid := auth.NewSID()
	if err := s.store.Create(context.Background(), sid, auth.Session{UserID: userID, Username: username}); err != nil {
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

// seed writes a real audio file per song so the playback service streams it.
func (s *server) seed(t *testing.T) (songPath1, songPath2 string) {
	t.Helper()
	dir := t.TempDir()
	songPath1 = filepath.Join(dir, "one.mp3")
	songPath2 = filepath.Join(dir, "two.mp3")
	if err := os.WriteFile(songPath1, []byte("audio-one-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(songPath2, []byte("audio-two-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.mustExec(t, `INSERT INTO users (id, username, password_hash) VALUES
		('user-alice', 'alice', 'x'), ('user-carol', 'carol', 'x')`)
	s.mustExec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, dir)
	s.mustExec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES ('user-alice', 'lib-a'), ('user-carol', 'lib-a')`)
	s.mustExec(t, `INSERT INTO artists (id, name, active) VALUES ('ar-one', 'Artist One', 1)`)
	s.mustExec(t, `INSERT INTO albums (id, name, artist_id, artist_name, active) VALUES
		('al-one', 'Album One', 'ar-one', 'Artist One', 1)`)
	s.mustExec(t, `INSERT INTO songs (id, file_path, title, artist_id, album_id, duration, mtime, checksum, active, library_id) VALUES
		('s-one', ?, 'Song One', 'ar-one', 'al-one', 200, 1, 'k1', 1, 'lib-a'),
		('s-two', ?, 'Song Two', 'ar-one', 'al-one', 250, 2, 'k2', 1, 'lib-a')`, songPath1, songPath2)
	return songPath1, songPath2
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

func decodePlayers(t *testing.T, rec *httptest.ResponseRecorder) []players.PlayerInfo {
	t.Helper()
	var body struct {
		Players []players.PlayerInfo `json:"players"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return body.Players
}

// ---------------------------------------------------------------------------
// Recording through the real streaming path
// ---------------------------------------------------------------------------

func TestStreamRecordsPlayer(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice")

	rec := s.do(t, http.MethodGet, "/api/stream/s-one", "SonarlyWeb/1.0", "", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("stream: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "audio-one-bytes" {
		t.Fatalf("stream body: %q", rec.Body.String())
	}

	list := s.do(t, http.MethodGet, "/api/players", "", "", alice)
	players := decodePlayers(t, list)
	if len(players) != 1 {
		t.Fatalf("want one player, got %+v", players)
	}
	p := players[0]
	if p.UserID != "user-alice" || p.SongID != "s-one" || p.SongTitle != "Song One" {
		t.Fatalf("entry: %+v", p)
	}
	if p.ClientID != "SonarlyWeb/1.0" {
		t.Fatalf("client id from user agent: %+v", p)
	}
	if p.ArtistName == nil || *p.ArtistName != "Artist One" || p.AlbumName == nil || *p.AlbumName != "Album One" {
		t.Fatalf("names resolved: %+v", p)
	}
	if p.DurationSeconds == nil || *p.DurationSeconds != 200 {
		t.Fatalf("duration: %+v", p)
	}
	if p.StartedAt == "" || p.UpdatedAt == "" {
		t.Fatalf("timestamps: %+v", p)
	}
}

func TestStreamClientQueryParamWins(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice")
	s.do(t, http.MethodGet, "/api/stream/s-one", "SonarlyWeb/1.0", "DesktopApp", alice)
	list := s.do(t, http.MethodGet, "/api/players", "", "", alice)
	players := decodePlayers(t, list)
	if len(players) != 1 || players[0].ClientID != "DesktopApp" {
		t.Fatalf("client param must win: %+v", players)
	}
}

func TestTwoUsersAndDevicesAreIsolated(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice")
	carol := s.session(t, "user-carol", "carol")

	s.do(t, http.MethodGet, "/api/stream/s-one", "Web", "", alice)
	s.do(t, http.MethodGet, "/api/stream/s-two", "Mobile", "", alice)
	s.do(t, http.MethodGet, "/api/stream/s-one", "Web", "", carol)

	list := s.do(t, http.MethodGet, "/api/players", "", "", alice)
	got := decodePlayers(t, list)
	if len(got) != 3 {
		t.Fatalf("three player entries expected: %+v", got)
	}
	byKey := map[string]players.PlayerInfo{}
	for _, p := range got {
		byKey[p.ID] = p
	}
	if byKey["user-alice|Web"].SongID != "s-one" {
		t.Fatalf("alice/web: %+v", byKey["user-alice|Web"])
	}
	if byKey["user-alice|Mobile"].SongID != "s-two" {
		t.Fatalf("alice/mobile: %+v", byKey["user-alice|Mobile"])
	}
	if byKey["user-carol|Web"].SongID != "s-one" {
		t.Fatalf("carol/web: %+v", byKey["user-carol|Web"])
	}
}

func TestStreamRefreshKeepsStartedAt(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice")
	s.do(t, http.MethodGet, "/api/stream/s-one", "Web", "", alice)
	first := decodePlayers(t, s.do(t, http.MethodGet, "/api/players", "", "", alice))[0]
	s.do(t, http.MethodGet, "/api/stream/s-two", "Web", "", alice)
	second := decodePlayers(t, s.do(t, http.MethodGet, "/api/players", "", "", alice))[0]
	if first.StartedAt != second.StartedAt {
		t.Fatalf("startedAt must survive refreshes: %s vs %s", first.StartedAt, second.StartedAt)
	}
	if second.SongID != "s-two" {
		t.Fatalf("song updated: %+v", second)
	}
}

func TestTTLExpiry(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice")
	s.do(t, http.MethodGet, "/api/stream/s-one", "Web", "", alice)
	if got := len(decodePlayers(t, s.do(t, http.MethodGet, "/api/players", "", "", alice))); got != 1 {
		t.Fatalf("fresh entry: %d", got)
	}

	// Age the entry past the TTL: the tracker's clock is injected.
	s.tracker.SetClock(func() time.Time { return time.Now().Add(players.TTL + time.Minute) })
	defer s.tracker.SetClock(nil)
	got := decodePlayers(t, s.do(t, http.MethodGet, "/api/players", "", "", alice))
	if len(got) != 0 {
		t.Fatalf("expired entry must vanish: %+v", got)
	}
}

func TestPlayersAuthz(t *testing.T) {
	s := newSeededServer(t)
	if rec := s.do(t, http.MethodGet, "/api/players", "", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anon: want 401, got %d", rec.Code)
	}
	alice := s.session(t, "user-alice", "alice")
	if rec := s.do(t, http.MethodGet, "/api/players", "", "", alice); rec.Code != http.StatusOK {
		t.Fatalf("alice: want 200, got %d", rec.Code)
	}
}
