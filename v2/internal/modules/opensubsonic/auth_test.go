package opensubsonic

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playback"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/players"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playlists"
)

const (
	testSecret  = "0123456789abcdef0123456789abcdef"
	testUserID  = "user-1"
	testUser    = "alice"
	testPass    = "sekret"
	testSalt    = "pepper"
	testAPIKey  = "sk_testkey"
	wrongAPIKey = "sk_wrong"
)

type testApp struct {
	db        *sql.DB
	store     *auth.Store
	router    http.Handler
	playback  *playback.Service
	tracker   *players.Tracker
	playlists *playlists.Service
}

func newTestApp(t *testing.T) *testApp {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	svc := playback.NewService(database, playback.Options{FFmpegPath: "ffmpeg"}, nil, nil)
	tracker := players.NewTracker()
	playlistSvc := playlists.NewService(database, playlists.NewPolicy())
	h := NewHandler(database, mw, testSecret, "/music", svc, tracker, playlistSvc)
	r := chi.NewRouter()
	h.Routes(r)
	return &testApp{db: database, store: store, router: r, playback: svc, tracker: tracker, playlists: playlistSvc}
}

func (a *testApp) seedUser(t *testing.T, id, username, password string, isAdmin bool) {
	t.Helper()
	var box *string
	if password != "" {
		encrypted, err := auth.EncryptSecret(password, testSecret)
		if err != nil {
			t.Fatalf("encrypt subsonic password: %v", err)
		}
		box = &encrypted
	}
	_, err := a.db.Exec(
		`INSERT INTO users (id, username, password_hash, subsonic_password_encrypted, is_admin, created_at)
		 VALUES (?, ?, 'x', ?, ?, '2026-01-01T00:00:00.000Z')`,
		id, username, box, isAdmin)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func (a *testApp) seedAPIKey(t *testing.T, key, userID string) {
	t.Helper()
	sum := sha256.Sum256([]byte(key))
	_, err := a.db.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash) VALUES ('k1', ?, ?)`,
		userID, hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatalf("seed api key: %v", err)
	}
}

func (a *testApp) sessionCookie(t *testing.T, sid, userID, username string, isAdmin bool) *http.Cookie {
	t.Helper()
	if err := a.store.Create(context.Background(), sid, auth.Session{UserID: userID, Username: username, IsAdmin: isAdmin}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, testSecret, false, sid)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("no cookie written")
	}
	return cookies[0]
}

func (a *testApp) head(t *testing.T, target string, headers map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodHead, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	a.router.ServeHTTP(rec, req)
	return rec
}

func (a *testApp) get(t *testing.T, target string, headers map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	a.router.ServeHTTP(rec, req)
	return rec
}

func tokenFor(password, salt string) string {
	sum := md5.Sum([]byte(password + salt))
	return hex.EncodeToString(sum[:])
}

// authedURL builds a /rest URL with valid u/t/s credentials.
func authedURL(path, extra string) string {
	return fmt.Sprintf("%s?u=%s&t=%s&s=%s%s", path, testUser, tokenFor(testPass, testSalt), testSalt, extra)
}

func assertOK(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("want HTTP 200, got %d", rec.Code)
	}
	var body struct {
		Response map[string]any `json:"subsonic-response"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Response["status"] != "ok" {
		t.Fatalf("want status ok, got %v", body.Response)
	}
	return body.Response
}

func assertFailed(t *testing.T, rec *httptest.ResponseRecorder, code float64) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("envelope errors keep HTTP 200 (quirks doc E1), got %d", rec.Code)
	}
	var body struct {
		Response map[string]any `json:"subsonic-response"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Response["status"] != "failed" {
		t.Fatalf("want status failed, got %v", body.Response)
	}
	errObj, ok := body.Response["error"].(map[string]any)
	if !ok {
		t.Fatalf("missing error object: %v", body.Response)
	}
	if errObj["code"] != code {
		t.Fatalf("error code = %v, want %v", errObj["code"], code)
	}
	return body.Response
}

func TestAPIKeyQueryParamAuth(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedAPIKey(t, testAPIKey, testUserID)

	rec := app.get(t, "/rest/ping.view?apiKey="+testAPIKey, nil)
	assertOK(t, rec)
}

func TestAPIKeyHeaderAuth(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedAPIKey(t, testAPIKey, testUserID)

	rec := app.get(t, "/rest/ping.view", map[string]string{auth.APIKeyHeader: testAPIKey})
	assertOK(t, rec)
}

func TestAPIKeyQueryTakesPrecedenceOverHeader(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedAPIKey(t, testAPIKey, testUserID)

	// v1 precedence: query apiKey beats the header (A1) — a valid query key
	// wins even next to an invalid header key.
	rec := app.get(t, "/rest/ping.view?apiKey="+testAPIKey,
		map[string]string{auth.APIKeyHeader: wrongAPIKey})
	assertOK(t, rec)
}

func TestAPIKeyInvalidRejected(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedAPIKey(t, testAPIKey, testUserID)

	rec := app.get(t, "/rest/ping.view?apiKey="+wrongAPIKey, nil)
	assertFailed(t, rec, CodeUnauthorized)

	rec = app.get(t, "/rest/ping.view", map[string]string{auth.APIKeyHeader: wrongAPIKey})
	assertFailed(t, rec, CodeUnauthorized)
}

func TestAPIKeyInvalidDoesNotFallThrough(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedAPIKey(t, testAPIKey, testUserID)
	cookie := app.sessionCookie(t, "sid-1", testUserID, testUser, false)

	// A2: an invalid apiKey short-circuits with 40 even when a valid session
	// cookie is present — it must not fall through to session auth.
	rec := app.get(t, "/rest/ping.view?apiKey="+wrongAPIKey, nil, cookie)
	assertFailed(t, rec, CodeUnauthorized)
}

func TestTokenAuthValid(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)

	rec := app.get(t, authedURL("/rest/ping.view", ""), nil)
	assertOK(t, rec)

	// The hook must attach the identity for handlers.
	rec = app.get(t, authedURL("/rest/getUser.view", ""), nil)
	env := assertOK(t, rec)
	user, ok := env["user"].(map[string]any)
	if !ok || user["username"] != testUser || user["adminRole"] != true {
		t.Fatalf("getUser after token auth = %v", env)
	}
}

func TestTokenAuthWrongSaltRejected(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	// Token computed for saltA but presented with saltB: mismatch → 40 when
	// no session can rescue it (A3/A5).
	target := fmt.Sprintf("/rest/ping.view?u=%s&t=%s&s=othersalt", testUser, tokenFor(testPass, testSalt))
	rec := app.get(t, target, nil)
	assertFailed(t, rec, CodeUnauthorized)
}

func TestTokenAuthWrongPasswordRejected(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	target := fmt.Sprintf("/rest/ping.view?u=%s&t=%s&s=%s", testUser, tokenFor("wrongpass", testSalt), testSalt)
	rec := app.get(t, target, nil)
	assertFailed(t, rec, CodeUnauthorized)
}

func TestTokenAuthMalformedTokenRejected(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	rec := app.get(t, fmt.Sprintf("/rest/ping.view?u=%s&t=zzz-not-hex&s=%s", testUser, testSalt), nil)
	assertFailed(t, rec, CodeUnauthorized)
}

func TestTokenAuthFallsBackToSession(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	cookie := app.sessionCookie(t, "sid-1", testUserID, testUser, false)

	// A5: wrong token does not reject on its own; a valid session cookie
	// still authenticates the request.
	target := fmt.Sprintf("/rest/ping.view?u=%s&t=bad&s=%s", testUser, testSalt)
	rec := app.get(t, target, nil, cookie)
	assertOK(t, rec)
}

func TestTokenAuthRequiresStoredPassword(t *testing.T) {
	app := newTestApp(t)
	// User without a subsonic password (never set one up).
	app.seedUser(t, testUserID, testUser, "", false)

	rec := app.get(t, authedURL("/rest/ping.view", ""), nil)
	assertFailed(t, rec, CodeUnauthorized)
}

func TestSessionCookieAuth(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	cookie := app.sessionCookie(t, "sid-1", testUserID, testUser, false)

	rec := app.get(t, "/rest/ping.view", nil, cookie)
	assertOK(t, rec)
}

func TestPasswordParamNotImplemented(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	// A7: p= password auth is documented but v1 never implemented it. With
	// u+p and no t/s the request lands in v1's missing-auth branch: code 10,
	// not 40.
	rec := app.get(t, "/rest/ping.view?u="+testUser+"&p="+testPass, nil)
	assertFailed(t, rec, CodeMissingParam)
}

func TestAnonymousRejected(t *testing.T) {
	app := newTestApp(t)

	// A6: v1 answers fully anonymous requests with 10 "Missing
	// authentication" (the P6.5 brief said 40; v1's code and tests assert
	// 10, so v1 parity wins — quirks doc A6).
	rec := app.get(t, "/rest/ping.view", nil)
	assertFailed(t, rec, CodeMissingParam)
}

func TestShareTokenBypassesAuthHook(t *testing.T) {
	app := newTestApp(t)

	// A8: getPlaylist.view with a shareToken passes the hook anonymously —
	// the endpoint (P9b) answers 70 "Data not found" for the nonexistent
	// playlist, which still proves the hook let it through: a blocked
	// request would be code 10 before any handler ran.
	rec := app.get(t, "/rest/getPlaylist.view?shareToken=tok123", nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestAuthHookAppliesToWholeRestGroup(t *testing.T) {
	app := newTestApp(t)
	// Every /rest/* route carries the hook, not just the system group.
	rec := app.get(t, "/rest/getUser.view", nil)
	assertFailed(t, rec, CodeMissingParam)
}
