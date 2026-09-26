package users_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/users"
)

const (
	secret    = "0123456789abcdef0123456789abcdef"
	adminPass = "admin-password-1"
	alicePass = "alice-password-1"
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
	svc := users.NewService(database, store, secret, t.TempDir())
	handler := users.NewHandler(svc, store, mw, secret, false)

	r := chi.NewRouter()
	handler.Routes(r)
	return &testServer{db: database, store: store, router: r}
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

func (s *testServer) responseCookies(rec *httptest.ResponseRecorder) []*http.Cookie {
	return rec.Result().Cookies()
}

// setup creates the first admin through the public setup endpoint and
// returns its session cookie.
func (s *testServer) setup(t *testing.T, username, password string) *http.Cookie {
	t.Helper()
	rec := s.do(t, http.MethodPost, "/api/setup", map[string]string{
		"username": username, "password": password,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup: want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	cookies := s.responseCookies(rec)
	if len(cookies) != 1 {
		t.Fatalf("setup must set a session cookie, got %d cookies", len(cookies))
	}
	return cookies[0]
}

// login performs a login and returns the session cookie.
func (s *testServer) login(t *testing.T, username, password string) *http.Cookie {
	t.Helper()
	rec := s.do(t, http.MethodPost, "/api/login", map[string]string{
		"username": username, "password": password,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("login %s: want 200, got %d: %s", username, rec.Code, rec.Body.String())
	}
	cookies := s.responseCookies(rec)
	if len(cookies) != 1 {
		t.Fatalf("login must set a session cookie, got %d", len(cookies))
	}
	return cookies[0]
}

func (s *testServer) createUser(t *testing.T, admin *http.Cookie, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	return s.do(t, http.MethodPost, "/api/admin/users", body, admin)
}

func (s *testServer) listUsers(t *testing.T, admin *http.Cookie) []map[string]any {
	t.Helper()
	rec := s.do(t, http.MethodGet, "/api/admin/users", nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("list users: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Users []map[string]any `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Users
}

func (s *testServer) findUser(t *testing.T, admin *http.Cookie, username string) map[string]any {
	t.Helper()
	for _, u := range s.listUsers(t, admin) {
		if u["username"] == username {
			return u
		}
	}
	t.Fatalf("user %q not found in list", username)
	return nil
}

// --- setup gate ---

func TestSetupFlow(t *testing.T) {
	s := newTestServer(t)

	rec := s.do(t, http.MethodGet, "/api/setup", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"needsSetup":true`) {
		t.Fatalf("pre-setup status: %d %s", rec.Code, rec.Body.String())
	}

	admin := s.setup(t, "admin", adminPass)
	var body map[string]any
	if err := json.Unmarshal(mustBody(s.do(t, http.MethodGet, "/api/me", nil, admin)), &body); err != nil {
		t.Fatal(err)
	}
	user := body["user"].(map[string]any)
	if user["username"] != "admin" || user["isAdmin"] != true {
		t.Fatalf("setup user: %+v", user)
	}

	rec = s.do(t, http.MethodGet, "/api/setup", nil)
	if !strings.Contains(rec.Body.String(), `"needsSetup":false`) {
		t.Fatalf("post-setup status: %s", rec.Body.String())
	}

	// Second setup attempt is rejected (v1 parity: 403).
	rec = s.do(t, http.MethodPost, "/api/setup", map[string]string{"username": "hacker", "password": "hacker-pass-1"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("second setup: want 403, got %d", rec.Code)
	}
	if n := len(s.listUsers(t, admin)); n != 1 {
		t.Fatalf("second setup must not create a user: have %d", n)
	}
}

func TestSetupValidation(t *testing.T) {
	cases := []struct {
		name     string
		body     map[string]string
		wantText string
	}{
		{"missing username", map[string]string{"password": adminPass}, "username is required"},
		{"blank username", map[string]string{"username": "   ", "password": adminPass}, "username is required"},
		{"missing password", map[string]string{"username": "admin"}, "password is required"},
		{"short password", map[string]string{"username": "admin", "password": "short"}, "password must be at least 8 characters"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newTestServer(t)
			rec := s.do(t, http.MethodPost, "/api/setup", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.wantText) {
				t.Fatalf("want error containing %q, got %s", tc.wantText, rec.Body.String())
			}
			// Failed validation must leave the gate open.
			rec = s.do(t, http.MethodGet, "/api/setup", nil)
			if !strings.Contains(rec.Body.String(), `"needsSetup":true`) {
				t.Fatalf("gate must stay open: %s", rec.Body.String())
			}
		})
	}
}

// --- login / logout / me ---

func TestLoginSuccessAndFailure(t *testing.T) {
	s := newTestServer(t)
	s.setup(t, "admin", adminPass)

	rec := s.do(t, http.MethodPost, "/api/login", map[string]string{"username": "admin", "password": adminPass})
	if rec.Code != http.StatusOK {
		t.Fatalf("login: want 200, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["user"].(map[string]any)["username"] != "admin" {
		t.Fatalf("login body: %s", rec.Body.String())
	}

	// Unknown user and wrong password must be indistinguishable.
	wrongUser := s.do(t, http.MethodPost, "/api/login", map[string]string{"username": "nobody", "password": "whatever-pass"})
	wrongPass := s.do(t, http.MethodPost, "/api/login", map[string]string{"username": "admin", "password": "wrong-pass"})
	if wrongUser.Code != http.StatusUnauthorized || wrongPass.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 for both, got %d / %d", wrongUser.Code, wrongPass.Code)
	}
	if wrongUser.Body.String() != wrongPass.Body.String() {
		t.Fatalf("responses must be identical:\n%s\n%s", wrongUser.Body.String(), wrongPass.Body.String())
	}
}

func TestLoginRegeneratesSessionID(t *testing.T) {
	s := newTestServer(t)
	s.setup(t, "admin", adminPass)

	// Attacker-fixated session the victim already holds a cookie for.
	oldSID := auth.NewSID()
	if err := s.store.Create(context.Background(), oldSID, auth.Session{UserID: "pre-fixation"}); err != nil {
		t.Fatal(err)
	}
	fixatedCookie := &http.Cookie{Name: auth.CookieName, Value: signValue(t, oldSID)}

	rec := s.do(t, http.MethodPost, "/api/login",
		map[string]string{"username": "admin", "password": adminPass}, fixatedCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}
	newCookies := s.responseCookies(rec)
	if len(newCookies) != 1 {
		t.Fatal("login must set a cookie")
	}
	newSID, ok := auth.VerifySignedValue(secret, newCookies[0].Value)
	if !ok {
		t.Fatal("new cookie must be signed")
	}
	if newSID == oldSID {
		t.Fatal("login must regenerate the session id (fixation protection)")
	}
	if _, err := s.store.Get(context.Background(), oldSID); err != auth.ErrNotFound {
		t.Fatalf("old session must be destroyed, got %v", err)
	}
	// And the new session authenticates.
	if rec := s.do(t, http.MethodGet, "/api/me", nil, newCookies[0]); rec.Code != http.StatusOK {
		t.Fatalf("new session must work: %d", rec.Code)
	}
}

func signValue(t *testing.T, sid string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, secret, false, sid)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("no cookie")
	}
	return cookies[0].Value
}

func TestMeRequiresAuth(t *testing.T) {
	s := newTestServer(t)
	s.setup(t, "admin", adminPass)

	if rec := s.do(t, http.MethodGet, "/api/me", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous /api/me: want 401, got %d", rec.Code)
	}
	bogus := &http.Cookie{Name: auth.CookieName, Value: "forged.value"}
	if rec := s.do(t, http.MethodGet, "/api/me", nil, bogus); rec.Code != http.StatusUnauthorized {
		t.Fatalf("forged cookie /api/me: want 401, got %d", rec.Code)
	}

	cookie := s.login(t, "admin", adminPass)
	rec := s.do(t, http.MethodGet, "/api/me", nil, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("authed /api/me: want 200, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "passwordHash") || strings.Contains(rec.Body.String(), "password_hash") {
		t.Fatalf("password hash leaked: %s", rec.Body.String())
	}
}

func TestLogout(t *testing.T) {
	s := newTestServer(t)
	s.setup(t, "admin", adminPass)
	cookie := s.login(t, "admin", adminPass)

	rec := s.do(t, http.MethodPost, "/api/logout", nil, cookie)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
	}
	cleared := s.responseCookies(rec)
	if len(cleared) == 0 || cleared[0].MaxAge >= 0 {
		t.Fatalf("logout must expire the cookie: %+v", cleared)
	}
	if rec := s.do(t, http.MethodGet, "/api/me", nil, cookie); rec.Code != http.StatusUnauthorized {
		t.Fatalf("session must be dead after logout: %d", rec.Code)
	}

	// Logout stays a polite no-op for anonymous clients (v1 parity).
	rec = s.do(t, http.MethodPost, "/api/logout", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("anonymous logout: %d %s", rec.Code, rec.Body.String())
	}
}

func TestLoginThrottle(t *testing.T) {
	s := newTestServer(t)
	adminCookie := s.setup(t, "admin", adminPass)

	// Five failures trip the lockout; even the right password is then 429.
	for i := 0; i < 5; i++ {
		rec := s.do(t, http.MethodPost, "/api/login", map[string]string{"username": "admin", "password": "nope-nope"})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d: want 401, got %d", i+1, rec.Code)
		}
	}
	rec := s.do(t, http.MethodPost, "/api/login", map[string]string{"username": "admin", "password": adminPass})
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("locked login: want 429, got %d", rec.Code)
	}

	// The lockout is keyed per username: a different account is unaffected.
	s.createUser(t, adminCookie, map[string]any{
		"username": "bob", "password": "bob-password-1",
	})
	rec = s.do(t, http.MethodPost, "/api/login", map[string]string{"username": "bob", "password": "wrong-pass"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("other username must not be locked: got %d", rec.Code)
	}
}

// --- admin authorization matrix ---

func TestAdminRoutesRequireAdmin(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	s.createUser(t, admin, map[string]any{"username": "alice", "password": alicePass})
	alice := s.login(t, "alice", alicePass)

	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete} {
		path := "/api/admin/users"
		if method == http.MethodPut || method == http.MethodDelete {
			path += "/some-id"
		}
		var rec *httptest.ResponseRecorder
		switch method {
		case http.MethodGet:
			rec = s.do(t, method, path, nil)
		case http.MethodPost:
			rec = s.do(t, method, path, map[string]string{"username": "x", "password": "x-password"})
		case http.MethodPut:
			rec = s.do(t, method, path, map[string]any{"isAdmin": true})
		default:
			rec = s.do(t, method, path, nil)
		}
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s %s: want 401, got %d", method, path, rec.Code)
		}
	}

	// Non-admin with a valid session: 403.
	if rec := s.do(t, http.MethodGet, "/api/admin/users", nil, alice); rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin list: want 403, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/admin/users/whatever", nil, alice); rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin delete: want 403, got %d", rec.Code)
	}
}

func TestAdminCreateUser(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)

	rec := s.createUser(t, admin, map[string]any{
		"username": "alice", "password": alicePass, "isAdmin": true,
		"name": "Alice", "email": "alice@example.com",
		"maxBitrateKbps": 320, "transcodeFormat": "mp3",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: want 201, got %d: %s", rec.Code, rec.Body.String())
	}

	alice := s.findUser(t, admin, "alice")
	if alice["isAdmin"] != true || alice["name"] != "Alice" || alice["maxBitrateKbps"] != float64(320) {
		t.Fatalf("created user: %+v", alice)
	}
	if _, leaked := alice["passwordHash"]; leaked {
		t.Fatal("password hash in list output")
	}

	// Duplicate username: 409.
	rec = s.createUser(t, admin, map[string]any{"username": "alice", "password": "other-pass-1"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate: want 409, got %d", rec.Code)
	}
}

func TestAdminCreateUserValidation(t *testing.T) {
	cases := []struct {
		name string
		body map[string]any
		want string
	}{
		{"missing username", map[string]any{"password": alicePass}, "username is required"},
		{"missing password", map[string]any{"username": "alice"}, "password is required"},
		{"short password", map[string]any{"username": "alice", "password": "tiny"}, "password must be at least 8 characters"},
		{"bad format", map[string]any{"username": "alice", "password": alicePass, "transcodeFormat": "wav"}, "invalid transcode format"},
		{"bitrate low", map[string]any{"username": "alice", "password": alicePass, "maxBitrateKbps": 63}, "invalid max bitrate"},
		{"bitrate high", map[string]any{"username": "alice", "password": alicePass, "maxBitrateKbps": 321}, "invalid max bitrate"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newTestServer(t)
			admin := s.setup(t, "admin", adminPass)
			rec := s.createUser(t, admin, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.want) {
				t.Fatalf("want %q, got %s", tc.want, rec.Body.String())
			}
		})
	}
}

func TestAdminUpdateLastAdminProtection(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	adminID := s.findUser(t, admin, "admin")["id"].(string)

	// Demoting the only admin is rejected.
	rec := s.do(t, http.MethodPut, "/api/admin/users/"+adminID, map[string]any{"isAdmin": false}, admin)
	if rec.Code != http.StatusConflict {
		t.Fatalf("demote last admin: want 409, got %d: %s", rec.Code, rec.Body.String())
	}

	// With a second admin in place, demotion succeeds...
	s.createUser(t, admin, map[string]any{"username": "second", "password": "second-pass-1", "isAdmin": true})
	rec = s.do(t, http.MethodPut, "/api/admin/users/"+adminID, map[string]any{"isAdmin": false}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("demote with second admin: want 200, got %d", rec.Code)
	}

	// ...and the role change invalidates sessions (v1 parity): the old
	// cookie is fully dead, not merely downgraded.
	rec = s.do(t, http.MethodGet, "/api/admin/users", nil, admin)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("demoted admin old session: want 401, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/me", nil, admin); rec.Code != http.StatusUnauthorized {
		t.Fatalf("demoted user old session on /api/me: want 401, got %d", rec.Code)
	}

	// After re-login the user is a plain user: authenticated (200 on /api/me)
	// but forbidden on admin routes — RequireAdmin re-reads the DB.
	newCookie := s.login(t, "admin", adminPass)
	if rec := s.do(t, http.MethodGet, "/api/me", nil, newCookie); rec.Code != http.StatusOK {
		t.Fatalf("re-logged demoted user keeps /api/me: want 200, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/admin/users", nil, newCookie); rec.Code != http.StatusForbidden {
		t.Fatalf("re-logged demoted user: want 403, got %d", rec.Code)
	}
}

func TestAdminUpdatePasswordInvalidatesSessions(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	s.createUser(t, admin, map[string]any{"username": "alice", "password": alicePass})
	alice := s.login(t, "alice", alicePass)
	aliceID := s.findUser(t, admin, "alice")["id"].(string)

	newPass := "rotated-password"
	rec := s.do(t, http.MethodPut, "/api/admin/users/"+aliceID, map[string]any{"password": newPass}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("password reset: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Every pre-existing session of that user is dead (audit B9).
	if rec := s.do(t, http.MethodGet, "/api/me", nil, alice); rec.Code != http.StatusUnauthorized {
		t.Fatalf("old session must be invalidated: %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPost, "/api/login", map[string]string{"username": "alice", "password": alicePass}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("old password must fail: %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPost, "/api/login", map[string]string{"username": "alice", "password": newPass}); rec.Code != http.StatusOK {
		t.Fatalf("new password must work: %d", rec.Code)
	}
}

func TestAdminUpdateIsAdminInvalidatesSessions(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	s.createUser(t, admin, map[string]any{"username": "alice", "password": alicePass})
	alice := s.login(t, "alice", alicePass)
	aliceID := s.findUser(t, admin, "alice")["id"].(string)

	rec := s.do(t, http.MethodPut, "/api/admin/users/"+aliceID, map[string]any{"isAdmin": true}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("promote: %d", rec.Code)
	}
	// v1 parity: a role change also kills sessions, so the old cookie is a
	// 401 (session gone), not merely a 403.
	if rec := s.do(t, http.MethodGet, "/api/admin/users", nil, alice); rec.Code != http.StatusUnauthorized {
		t.Fatalf("session must be invalidated on role change: got %d", rec.Code)
	}
	alice = s.login(t, "alice", alicePass)
	if rec := s.do(t, http.MethodGet, "/api/admin/users", nil, alice); rec.Code != http.StatusOK {
		t.Fatalf("re-login as promoted admin: want 200, got %d", rec.Code)
	}
}

func TestAdminUpdateValidationAndMissingUser(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	adminID := s.findUser(t, admin, "admin")["id"].(string)

	rec := s.do(t, http.MethodPut, "/api/admin/users/does-not-exist", map[string]any{"isAdmin": true}, admin)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing user: want 404, got %d", rec.Code)
	}

	cases := []struct {
		name string
		body map[string]any
		want string
	}{
		{"bad format", map[string]any{"transcodeFormat": "wav"}, "invalid transcode format"},
		{"bitrate low", map[string]any{"maxBitrateKbps": 10}, "invalid max bitrate"},
		{"short password", map[string]any{"password": "tiny"}, "password must be at least 8 characters"},
	}
	for _, tc := range cases {
		rec := s.do(t, http.MethodPut, "/api/admin/users/"+adminID, tc.body, admin)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", tc.name, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), tc.want) {
			t.Fatalf("%s: want %q, got %s", tc.name, tc.want, rec.Body.String())
		}
	}
}

func TestAdminUpdatePartialDoesNotClobber(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	s.createUser(t, admin, map[string]any{
		"username": "alice", "password": alicePass, "maxBitrateKbps": 320,
	})
	aliceID := s.findUser(t, admin, "alice")["id"].(string)

	// Setting only the transcode format must leave the bitrate alone.
	rec := s.do(t, http.MethodPut, "/api/admin/users/"+aliceID, map[string]any{"transcodeFormat": "opus"}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d", rec.Code)
	}
	alice := s.findUser(t, admin, "alice")
	if alice["maxBitrateKbps"] != float64(320) || alice["transcodeFormat"] != "opus" {
		t.Fatalf("partial update clobbered fields: %+v", alice)
	}

	// Explicit null clears; absent leaves untouched.
	rec = s.do(t, http.MethodPut, "/api/admin/users/"+aliceID, map[string]any{"maxBitrateKbps": nil}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear bitrate: %d", rec.Code)
	}
	alice = s.findUser(t, admin, "alice")
	if _, present := alice["maxBitrateKbps"]; present {
		t.Fatalf("explicit null must clear bitrate: %+v", alice)
	}
	if alice["transcodeFormat"] != "opus" {
		t.Fatalf("absent field must be untouched: %+v", alice)
	}

	// Content filters and profile fields.
	rec = s.do(t, http.MethodPut, "/api/admin/users/"+aliceID,
		map[string]any{"hideExplicit": true, "name": "Alice A."}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("filters update: %d", rec.Code)
	}
	alice = s.findUser(t, admin, "alice")
	if alice["hideExplicit"] != true || alice["name"] != "Alice A." {
		t.Fatalf("filters/profile not applied: %+v", alice)
	}
}

func TestAdminDeleteSelfForbidden(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	adminID := s.findUser(t, admin, "admin")["id"].(string)

	rec := s.do(t, http.MethodDelete, "/api/admin/users/"+adminID, nil, admin)
	if rec.Code != http.StatusConflict {
		t.Fatalf("self delete: want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if n := len(s.listUsers(t, admin)); n != 1 {
		t.Fatalf("self must survive: have %d users", n)
	}
}

func TestAdminDeleteLastAdminForbidden(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	adminID := s.findUser(t, admin, "admin")["id"].(string)

	// Service-level: actor != target is possible internally (routes always
	// have an admin actor, so via HTTP this state is only reachable when two
	// admins exist and one is deleted — covered below).
	svc := users.NewService(s.db, s.store, secret, t.TempDir())
	if err := svc.DeleteUser(context.Background(), "other-actor", adminID); err != users.ErrLastAdminDelete {
		t.Fatalf("want ErrLastAdminDelete, got %v", err)
	}
}

func TestAdminDeleteUser(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)
	s.createUser(t, admin, map[string]any{"username": "alice", "password": alicePass})
	s.createUser(t, admin, map[string]any{"username": "bob", "password": "bob-password-1", "isAdmin": true})
	alice := s.login(t, "alice", alicePass)
	aliceID := s.findUser(t, admin, "alice")["id"].(string)
	bobID := s.findUser(t, admin, "bob")["id"].(string)

	rec := s.do(t, http.MethodDelete, "/api/admin/users/"+aliceID, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Deleting an admin while another admin exists is allowed.
	rec = s.do(t, http.MethodDelete, "/api/admin/users/"+bobID, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete other admin: want 200, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/admin/users/nope", nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("delete missing: want 404, got %d", rec.Code)
	}

	// The deleted user's sessions are gone with the row.
	if rec := s.do(t, http.MethodGet, "/api/me", nil, alice); rec.Code != http.StatusUnauthorized {
		t.Fatalf("deleted user's session must be dead: %d", rec.Code)
	}
	var sessions int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 1 { // only the admin's own session remains
		t.Fatalf("want 1 remaining session, have %d", sessions)
	}
}

func mustBody(rec *httptest.ResponseRecorder) []byte {
	return rec.Body.Bytes()
}
