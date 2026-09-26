package auth_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

const testSecret = "0123456789abcdef0123456789abcdef"

// testApp is a minimal router exercising the middleware chain the same way
// the users module composes it.
type testApp struct {
	db     *sql.DB
	store  *auth.Store
	mw     *auth.Middleware
	router http.Handler
}

func newTestApp(t *testing.T) *testApp {
	t.Helper()
	database := openDB(t)
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)

	r := chi.NewRouter()
	r.With(mw.AuthMiddleware).Get("/ident", func(w http.ResponseWriter, r *http.Request) {
		id, ok := auth.IdentityFrom(r.Context())
		if !ok {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"userId": id.UserID, "username": id.Username, "isAdmin": id.IsAdmin,
		})
	})
	r.With(mw.AuthMiddleware, auth.RequireAuth).Get("/protected", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})
	r.With(mw.AuthMiddleware, auth.RequireAuth, mw.RequireAdmin).Get("/admin", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})

	return &testApp{db: database, store: store, mw: mw, router: r}
}

func (a *testApp) insertUser(t *testing.T, id, username string, isAdmin bool) {
	t.Helper()
	_, err := a.db.Exec(
		`INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, 'x', ?)`,
		id, username, isAdmin)
	if err != nil {
		t.Fatal(err)
	}
}

func (a *testApp) sessionCookie(t *testing.T, sid string, sess auth.Session) *http.Cookie {
	t.Helper()
	if err := a.store.Create(context.Background(), sid, sess); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, testSecret, false, sid)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("no cookie written")
	}
	return cookies[0]
}

func (a *testApp) get(t *testing.T, path string, headers map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
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

func TestRequireAuthRejectsAnonymous(t *testing.T) {
	app := newTestApp(t)
	if rec := app.get(t, "/protected", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: want 401, got %d", rec.Code)
	}
}

func TestAuthMiddlewareAttachesIdentity(t *testing.T) {
	app := newTestApp(t)
	app.insertUser(t, "u1", "alice", true)
	cookie := app.sessionCookie(t, "sid-1", auth.Session{UserID: "u1", Username: "alice", IsAdmin: true})

	rec := app.get(t, "/ident", nil, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var body struct {
		UserID   string `json:"userId"`
		Username string `json:"username"`
		IsAdmin  bool   `json:"isAdmin"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.UserID != "u1" || body.Username != "alice" || !body.IsAdmin {
		t.Fatalf("identity mismatch: %+v", body)
	}
}

func TestAuthMiddlewareRejectsTamperedCookie(t *testing.T) {
	app := newTestApp(t)
	cookie := app.sessionCookie(t, "sid-1", auth.Session{UserID: "u1"})
	cookie.Value = "forged" + cookie.Value[6:]

	if rec := app.get(t, "/protected", nil, cookie); rec.Code != http.StatusUnauthorized {
		t.Fatalf("tampered cookie: want 401, got %d", rec.Code)
	}
}

func TestAuthMiddlewareExpiredSessionRejected(t *testing.T) {
	app := newTestApp(t)
	sess := auth.Session{UserID: "u1"}
	if err := app.store.Create(context.Background(), "dead", sess); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(
		`UPDATE sessions SET expire = '2000-01-01T00:00:00.000Z' WHERE sid = 'dead'`); err != nil {
		t.Fatal(err)
	}
	cookie := signCookieOnly(t, "dead")

	if rec := app.get(t, "/protected", nil, cookie); rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired session: want 401, got %d", rec.Code)
	}
}

func signCookieOnly(t *testing.T, sid string) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, testSecret, false, sid)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("no cookie")
	}
	return cookies[0]
}

func TestRequireAdminReReadsDatabase(t *testing.T) {
	app := newTestApp(t)
	app.insertUser(t, "admin-1", "boss", false) // row starts non-admin

	// Fresh promotion in the DB must take effect without a new login: the
	// session snapshot below says isAdmin=false.
	if _, err := app.db.Exec(`UPDATE users SET is_admin = 1 WHERE id = 'admin-1'`); err != nil {
		t.Fatal(err)
	}
	if err := app.store.Create(context.Background(), "sid-snap-false",
		auth.Session{UserID: "admin-1", Username: "boss", IsAdmin: false}); err != nil {
		t.Fatal(err)
	}
	if rec := app.get(t, "/admin", nil, signCookieOnly(t, "sid-snap-false")); rec.Code != http.StatusOK {
		t.Fatalf("promoted user: want 200, got %d", rec.Code)
	}

	// Demotion must also take effect immediately, despite the session
	// snapshot saying isAdmin=true.
	if _, err := app.db.Exec(`UPDATE users SET is_admin = 0 WHERE id = 'admin-1'`); err != nil {
		t.Fatal(err)
	}
	if err := app.store.Create(context.Background(), "sid-snap-true",
		auth.Session{UserID: "admin-1", Username: "boss", IsAdmin: true}); err != nil {
		t.Fatal(err)
	}
	if rec := app.get(t, "/admin", nil, signCookieOnly(t, "sid-snap-true")); rec.Code != http.StatusForbidden {
		t.Fatalf("demoted admin with valid cookie: want 403, got %d", rec.Code)
	}
}

func TestRequireAdminUnknownUserForbidden(t *testing.T) {
	app := newTestApp(t)
	// Session references a user row that no longer exists.
	cookie := app.sessionCookie(t, "sid-ghost", auth.Session{UserID: "ghost", IsAdmin: true})
	if rec := app.get(t, "/admin", nil, cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("deleted user: want 403, got %d", rec.Code)
	}
}

func TestAPIKeyAuth(t *testing.T) {
	app := newTestApp(t)
	app.insertUser(t, "u-key", "keyuser", true)

	sum := sha256.Sum256([]byte("supersecretkey"))
	if _, err := app.db.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash) VALUES ('k1', 'u-key', ?)`, hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}

	rec := app.get(t, "/protected", map[string]string{auth.APIKeyHeader: "supersecretkey"})
	if rec.Code != http.StatusOK {
		t.Fatalf("valid api key: want 200, got %d", rec.Code)
	}

	rec = app.get(t, "/ident", map[string]string{auth.APIKeyHeader: "supersecretkey"})
	var body struct {
		UserID  string `json:"userId"`
		IsAdmin bool   `json:"isAdmin"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.UserID != "u-key" || !body.IsAdmin {
		t.Fatalf("api key identity mismatch: %+v", body)
	}

	rec = app.get(t, "/protected", map[string]string{auth.APIKeyHeader: "wrongkey"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad api key: want 401, got %d", rec.Code)
	}
}

func TestAPIKeyForDeletedUserRejected(t *testing.T) {
	app := newTestApp(t)
	sum := sha256.Sum256([]byte("orphankey"))
	if _, err := app.db.Exec(
		`INSERT INTO users (id, username, password_hash) VALUES ('gone', 'gone', 'x')`); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash) VALUES ('k1', 'gone', ?)`, hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(`DELETE FROM users WHERE id = 'gone'`); err != nil {
		t.Fatal(err)
	}
	rec := app.get(t, "/protected", map[string]string{auth.APIKeyHeader: "orphankey"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("orphaned api key: want 401, got %d", rec.Code)
	}
}

func TestInvalidCookieFallsBackToAPIKey(t *testing.T) {
	app := newTestApp(t)
	app.insertUser(t, "u-key2", "keyuser2", false)
	sum := sha256.Sum256([]byte("fallbackkey"))
	if _, err := app.db.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash) VALUES ('k2', 'u-key2', ?)`, hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}
	bogus := &http.Cookie{Name: auth.CookieName, Value: "tampered.value"}
	rec := app.get(t, "/protected", map[string]string{auth.APIKeyHeader: "fallbackkey"}, bogus)
	if rec.Code != http.StatusOK {
		t.Fatalf("api key fallback: want 200, got %d", rec.Code)
	}
}
