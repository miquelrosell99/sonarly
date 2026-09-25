package playback

import (
	"bytes"
	"context"
	"database/sql"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/config"
	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

const testSecret = "0123456789abcdef0123456789abcdef"

// corpusDir holds the P4a audio corpus; files are copied into per-test
// library roots so duration/bitrate are real.
const corpusDir = "../../audio/testdata/corpus"

// oddName exercises the download filename sanitization (quote, backslash,
// newline — all legal in Linux filenames).
const oddName = "we\"ird\\na\nme.mp3"

type testEnv struct {
	db     *sql.DB
	store  *auth.Store
	svc    *Service
	srv    *httptest.Server
	client *http.Client // cookie jar per-user sessions are set per request
	logBuf *bytes.Buffer
	files  map[string]string // song id → absolute file path
}

// newEnv boots the full production chain (httpserver middleware incl. the
// streaming-timeout exemption, real session auth, playback routes) over a
// seeded in-memory database and real corpus files in temp library roots.
func newEnv(t *testing.T, opts Options) *testEnv {
	t.Helper()
	ctx := context.Background()
	database, err := db.OpenInMemory(ctx)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	logBuf := &bytes.Buffer{}
	log := slog.New(slog.NewTextHandler(logBuf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	svc := NewService(database, opts, log)
	mw := auth.NewMiddleware(auth.NewStore(database), database, testSecret, false)
	handler := httpserver.New(config.Config{}, log)
	NewHandler(svc, mw).Routes(handler.Router())
	srv := httptest.NewServer(handler)
	t.Cleanup(func() {
		srv.Close()
		// No ffmpeg may outlive its server: disconnect kill or context cancel.
		deadline := time.Now().Add(3 * time.Second)
		for {
			if pids := svc.TranscodingStreamer().LivePIDSnapshot(); len(pids) == 0 {
				return
			}
			if time.Now().After(deadline) {
				t.Errorf("zombie ffmpeg processes left: %v", svc.TranscodingStreamer().LivePIDSnapshot())
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
	})

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}

	env := &testEnv{
		db:     database,
		store:  auth.NewStore(database),
		svc:    svc,
		srv:    srv,
		client: &http.Client{Jar: jar},
		logBuf: logBuf,
		files:  map[string]string{},
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

// do performs one request against the test server. body may be nil.
func (e *testEnv) do(t *testing.T, method, path string, cookie *http.Cookie, body any) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		switch b := body.(type) {
		case string:
			reader = strings.NewReader(b)
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

// copySong copies a corpus file into dir and returns its absolute path.
func copySong(t *testing.T, dir, corpusFile, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(corpusDir, corpusFile))
	if err != nil {
		t.Fatalf("read corpus %s: %v", corpusFile, err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write library file: %v", err)
	}
	return path
}

// seed builds two libraries with real corpus-backed songs and five users
// covering every scope/pref edge:
//
//	user-admin:  admin (sees everything, incl. the NULL-library song)
//	user-alice:  lib-a, transcode_format=mp3, max_bitrate_kbps=320
//	user-plain:  lib-a, no transcode prefs (query-driven decisions)
//	user-carol:  lib-b
//	user-bob:    no libraries (match-nothing scope)
//
//	s-a1        lib-a  spike.mp3                134 kbps, active
//	s-a2        lib-a  spike.flac                 ~6 kbps, active
//	s-odd       lib-a  odd filename mp3           134 kbps, active
//	s-corrupt   lib-a  garbage bytes named .flac  NULL bitrate, active
//	s-inactive  lib-a  active = 0
//	s-b1        lib-b  pathological-id3v1.mp3     128 kbps, active
//	s-nolib     NULL   spike.flac                 ~6 kbps, admin-only
func (e *testEnv) seed(t *testing.T) {
	t.Helper()
	exec := e.mustExec

	libA := t.TempDir()
	libB := t.TempDir()

	a1 := copySong(t, libA, "spike.mp3", "01 - One.mp3")
	a2 := copySong(t, libA, "spike.flac", "02 - Two.flac")
	odd := copySong(t, libA, "spike.mp3", oddName)
	// fLaC magic + garbage: the flac demuxer is selected, decoding fails
	// immediately, ffmpeg exits 1 with zero stdout bytes (deterministic
	// pre-first-byte transcode failure).
	corrupt := copySong(t, libA, "spike.flac", "corrupt.flac")
	os.WriteFile(corrupt, append([]byte("fLaC"), []byte(strings.Repeat("\xde\xad\xbe\xef", 50000))...), 0o644)
	inactive := copySong(t, libA, "spike.mp3", "ghost.mp3")
	b1 := copySong(t, libB, "pathological-id3v1.mp3", "01 - Beta.mp3")
	nolib := copySong(t, libA, "spike.flac", "nolib.flac")

	exec(t, `INSERT INTO users (id, username, password_hash, is_admin, max_bitrate_kbps, transcode_format) VALUES
		('user-admin', 'root',  'x', 1, NULL, NULL),
		('user-alice', 'alice', 'x', 0, 320, 'mp3'),
		('user-plain', 'plain', 'x', 0, NULL, NULL),
		('user-carol', 'carol', 'x', 0, NULL, NULL),
		('user-bob',   'bob',   'x', 0, NULL, NULL)`)
	exec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
		('lib-b', 'Library B', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, libA, libB)
	exec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES
		('user-alice', 'lib-a'), ('user-plain', 'lib-a'), ('user-carol', 'lib-b')`)

	exec(t, `INSERT INTO artists (id, name, active) VALUES
		('ar-alpha', 'Alpha', 1), ('ar-beta', 'Beta', 1)`)
	exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, active) VALUES
		('al-a1', 'A1', 'ar-alpha', 'Alpha', 1), ('al-b1', 'B1', 'ar-beta', 'Beta', 1)`)

	songs := []struct {
		id, path, title string
		artist, album   any // nil or row id
		bitRate         any
		active          int
		library         any // nil or row id
	}{
		{"s-a1", a1, "One", "ar-alpha", "al-a1", 134103, 1, "lib-a"},
		{"s-a2", a2, "Two", "ar-alpha", "al-a1", 6149, 1, "lib-a"},
		{"s-odd", odd, "Odd", "ar-alpha", "al-a1", 134103, 1, "lib-a"},
		{"s-corrupt", corrupt, "Corrupt", nil, nil, nil, 1, "lib-a"},
		{"s-inactive", inactive, "Ghost", nil, nil, nil, 0, "lib-a"},
		{"s-b1", b1, "Beta One", "ar-beta", "al-b1", 128000, 1, "lib-b"},
		{"s-nolib", nolib, "NoLib", nil, nil, 6149, 1, nil},
	}
	for _, s := range songs {
		var mediaType any
		if strings.HasSuffix(s.path, ".mp3") {
			mediaType = "audio/mpeg"
		}
		exec(t, `INSERT INTO songs (id, file_path, title, duration, artist_id, album_id, mtime, checksum,
				active, bit_rate, library_id, media_type)
			VALUES (?, ?, ?, 3, ?, ?, 100, ?, ?, ?, ?, ?)`,
			s.id, s.path, s.title, s.artist, s.album, "k-"+s.id, s.active, s.bitRate, s.library, mediaType)
		e.files[s.id] = s.path
	}
}

// requireFFmpeg skips transcode tests when ffmpeg is not on PATH.
func requireFFmpeg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
}

// fakeFFmpeg writes an executable shell script as a stand-in ffmpeg binary
// and returns its path. The script appends its argv (one line per spawn) to
// the file named by FAKE_FFMPEG_LOG and then runs scriptBody.
func fakeFFmpeg(t *testing.T, scriptBody string) string {
	t.Helper()
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh not available")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "ffmpeg-fake")
	script := "#!/bin/sh\necho \"$@\" >> \"$FAKE_FFMPEG_LOG\"\n" + scriptBody + "\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake ffmpeg: %v", err)
	}
	t.Setenv("FAKE_FFMPEG_LOG", filepath.Join(dir, "argv.log"))
	return path
}

// readFakeArgv returns the logged argv lines of the fake ffmpeg.
func readFakeArgv(t *testing.T) []string {
	t.Helper()
	logPath := os.Getenv("FAKE_FFMPEG_LOG")
	data, err := os.ReadFile(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		t.Fatalf("read fake argv log: %v", err)
	}
	return strings.Split(strings.TrimRight(string(data), "\n"), "\n")
}

// lastBitrateArg extracts the -b:a value from an argv line (e.g. "320k").
func lastBitrateArg(t *testing.T, argvLine string) string {
	t.Helper()
	fields := strings.Fields(argvLine)
	for i, f := range fields {
		if f == "-b:a" && i+1 < len(fields) {
			return fields[i+1]
		}
	}
	t.Fatalf("no -b:a in argv line: %q", argvLine)
	return ""
}

// waitSpawned blocks until the streamer reports another spawned ffmpeg PID.
func (e *testEnv) waitSpawned(t *testing.T) int {
	t.Helper()
	select {
	case pid := <-e.svc.TranscodingStreamer().spawned:
		return pid
	case <-time.After(10 * time.Second):
		t.Fatal("no ffmpeg spawned within 10s")
		return 0
	}
}

// waitPIDGone polls /proc/<pid> at ~1 ms resolution (S2 measurement aid).
func waitPIDGone(pid int, timeout time.Duration) (time.Duration, bool) {
	start := time.Now()
	for time.Since(start) < timeout {
		if !pidAlive(pid) {
			return time.Since(start), true
		}
		time.Sleep(time.Millisecond)
	}
	return timeout, false
}

func fileBytes(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// readAll drains and closes a response body (tests that drive raw requests).
func readAll(t *testing.T, res *http.Response) []byte {
	t.Helper()
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// mp3FrameSync accounts for the ID3v2 tag ffmpeg's mp3 muxer writes at the
// head of pipe output (v1 behaves identically — same argv), then checks the
// MPEG frame sync.
func mp3FrameSync(b []byte) bool {
	off := 0
	if len(b) >= 10 && string(b[:3]) == "ID3" {
		size := int(b[6]&0x7f)<<21 | int(b[7]&0x7f)<<14 | int(b[8]&0x7f)<<7 | int(b[9]&0x7f)
		off = 10 + size
	}
	return len(b) >= off+2 && b[off] == 0xFF && b[off+1]&0xE0 == 0xE0
}

// drainSpawned empties the spawned-PID channel (call before tests that count
// subsequent spawns).
func (e *testEnv) drainSpawned() {
	for {
		select {
		case <-e.svc.TranscodingStreamer().spawned:
		default:
			return
		}
	}
}
