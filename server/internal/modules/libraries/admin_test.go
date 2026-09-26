package libraries_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type server struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
}

func newServer(t *testing.T) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	r := chi.NewRouter()
	libraries.NewHandler(database, mw).Routes(r)
	return &server{db: database, store: store, router: r}
}

func (s *server) do(t *testing.T, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func (s *server) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
	t.Helper()
	if _, err := s.db.Exec(
		`INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, 'x', ?)
		 ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin`,
		userID, username, boolToInt(isAdmin)); err != nil {
		t.Fatalf("insert user: %v", err)
	}
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

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

// createLibrary inserts a library row directly (bypassing the invariant to
// set up specific scenarios).
func (s *server) createLibrary(t *testing.T, id, name, path string, isDefault bool) {
	t.Helper()
	if _, err := s.db.Exec(
		`INSERT INTO libraries (id, name, path, organize_pattern, is_default, created_at, updated_at)
		 VALUES (?, ?, ?, '{album}/{title}', ?, datetime('now'), datetime('now'))`,
		id, name, path, boolToInt(isDefault)); err != nil {
		t.Fatalf("insert library: %v", err)
	}
}

func TestPickerListRequiresAuth(t *testing.T) {
	s := newServer(t)
	if rec := s.do(t, http.MethodGet, "/api/libraries", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous picker list: want 401, got %d", rec.Code)
	}
}

func TestPickerListScopesToAssignments(t *testing.T) {
	s := newServer(t)
	s.createLibrary(t, "lib-a", "Alpha", "/music/a", true)
	s.createLibrary(t, "lib-b", "Beta", "/music/b", false)
	s.createLibrary(t, "lib-c", "Gamma", "/music/c", false)

	// Admin sees everything.
	admin := s.session(t, "u-admin", "admin", true)
	rec := s.do(t, http.MethodGet, "/api/libraries", nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin picker: want 200, got %d", rec.Code)
	}
	libs := decode(t, rec)["libraries"].([]any)
	if len(libs) != 3 {
		t.Fatalf("admin sees %d libraries, want 3", len(libs))
	}
	for _, item := range libs {
		entry := item.(map[string]any)
		if _, leaks := entry["path"]; leaks {
			t.Fatal("picker DTO leaks the host path")
		}
		if _, leaks := entry["organizePattern"]; leaks {
			t.Fatal("picker DTO leaks the organize pattern")
		}
	}

	// A non-admin with one assignment sees only that one.
	user := s.session(t, "u-user", "user", false)
	if _, err := s.db.Exec(
		`INSERT INTO user_libraries (user_id, library_id) VALUES ('u-user', 'lib-b')`); err != nil {
		t.Fatal(err)
	}
	rec = s.do(t, http.MethodGet, "/api/libraries", nil, user)
	if rec.Code != http.StatusOK {
		t.Fatalf("user picker: want 200, got %d", rec.Code)
	}
	libs = decode(t, rec)["libraries"].([]any)
	if len(libs) != 1 {
		t.Fatalf("user sees %d libraries, want 1", len(libs))
	}
	if libs[0].(map[string]any)["name"] != "Beta" {
		t.Fatalf("user sees %v, want Beta", libs[0])
	}

	// A non-admin with no assignments sees none (never everything).
	stranger := s.session(t, "u-stranger", "stranger", false)
	rec = s.do(t, http.MethodGet, "/api/libraries", nil, stranger)
	if rec.Code != http.StatusOK {
		t.Fatalf("stranger picker: want 200, got %d", rec.Code)
	}
	if libs := decode(t, rec)["libraries"].([]any); len(libs) != 0 {
		t.Fatalf("stranger sees %d libraries, want 0", len(libs))
	}
}

func TestAdminLibraryCRUDMatrix(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	user := s.session(t, "u-user", "user", false)

	// Auth matrix.
	if rec := s.do(t, http.MethodGet, "/api/admin/libraries", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous list: want 401, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/admin/libraries", nil, user); rec.Code != http.StatusForbidden {
		t.Fatalf("user list: want 403, got %d", rec.Code)
	}

	// Create validation.
	if rec := s.do(t, http.MethodPost, "/api/admin/libraries", map[string]any{"name": ""}, admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("create empty name: want 400, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPost, "/api/admin/libraries", "not-an-object", admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("create bad body: want 400, got %d", rec.Code)
	}

	// The first library becomes default automatically.
	rec := s.do(t, http.MethodPost, "/api/admin/libraries", map[string]any{"name": "One", "path": "/music/one"}, admin)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: want 201, got %d", rec.Code)
	}
	var count, isDefault int
	if err := s.db.QueryRow(`SELECT COUNT(*), is_default FROM libraries WHERE name = 'One'`).Scan(&count, &isDefault); err != nil {
		t.Fatal(err)
	}
	if isDefault != 1 {
		t.Fatal("first library was not forced default")
	}

	// Duplicate path → 409.
	if rec := s.do(t, http.MethodPost, "/api/admin/libraries", map[string]any{"name": "Dup", "path": "/music/one"}, admin); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate path: want 409, got %d", rec.Code)
	}

	// Explicit default clears the others (the tx invariant).
	rec = s.do(t, http.MethodPost, "/api/admin/libraries", map[string]any{"name": "Two", "path": "/music/two", "isDefault": true}, admin)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create two: want 201, got %d", rec.Code)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM libraries WHERE is_default = 1`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected exactly one default, got %d", count)
	}
	if err := s.db.QueryRow(`SELECT is_default FROM libraries WHERE name = 'One'`).Scan(&isDefault); err != nil {
		t.Fatal(err)
	}
	if isDefault != 0 {
		t.Fatal("setting a new default did not clear the old one")
	}

	// Update: partial, 404, unique path 409.
	var twoID string
	if err := s.db.QueryRow(`SELECT id FROM libraries WHERE name = 'Two'`).Scan(&twoID); err != nil {
		t.Fatal(err)
	}
	if rec := s.do(t, http.MethodPut, "/api/admin/libraries/"+twoID, map[string]any{"name": "Two Renamed"}, admin); rec.Code != http.StatusOK {
		t.Fatalf("update: want 200, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPut, "/api/admin/libraries/nope", map[string]any{"name": "x"}, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("update missing: want 404, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPut, "/api/admin/libraries/"+twoID, map[string]any{"path": "/music/one"}, admin); rec.Code != http.StatusConflict {
		t.Fatalf("update duplicate path: want 409, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPut, "/api/admin/libraries/"+twoID, map[string]any{"name": ""}, admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("update empty name: want 400, got %d", rec.Code)
	}

	// Delete: 404, then deleting the default promotes the next by name.
	if rec := s.do(t, http.MethodDelete, "/api/admin/libraries/nope", nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("delete missing: want 404, got %d", rec.Code)
	}
	s.createLibrary(t, "lib-aaa", "Aaa", "/music/aaa", false)
	if rec := s.do(t, http.MethodDelete, "/api/admin/libraries/"+twoID, nil, admin); rec.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d", rec.Code)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM libraries WHERE is_default = 1`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("after default delete: %d defaults, want 1", count)
	}
	var promoted string
	if err := s.db.QueryRow(`SELECT name FROM libraries WHERE is_default = 1`).Scan(&promoted); err != nil {
		t.Fatal(err)
	}
	// "Aaa" < "One" alphabetically → Aaa is promoted.
	if promoted != "Aaa" {
		t.Fatalf("promoted %q, want Aaa (first by name)", promoted)
	}
}

func TestLibraryUserAssignmentCRUD(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	s.createLibrary(t, "lib-a", "Alpha", "/music/a", true)
	s.createLibrary(t, "lib-b", "Beta", "/music/b", false)
	s.session(t, "u-1", "one", false)
	s.session(t, "u-2", "two", false)

	// 404s on unknown ids, both directions.
	if rec := s.do(t, http.MethodGet, "/api/admin/libraries/nope/users", nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("library users 404: got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/admin/users/nope/libraries", nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("user libraries 404: got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPost, "/api/admin/libraries/nope/users", map[string]any{"userIds": []string{"u-1"}}, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("assign users 404: got %d", rec.Code)
	}

	// assign → list (library direction)
	if rec := s.do(t, http.MethodPost, "/api/admin/libraries/lib-a/users", map[string]any{"userIds": []string{"u-1", "u-2"}}, admin); rec.Code != http.StatusOK {
		t.Fatalf("assign users: want 200, got %d", rec.Code)
	}
	// duplicates ignored (re-assign u-1)
	if rec := s.do(t, http.MethodPost, "/api/admin/libraries/lib-a/users", map[string]any{"userIds": []string{"u-1"}}, admin); rec.Code != http.StatusOK {
		t.Fatalf("re-assign: want 200, got %d", rec.Code)
	}
	rec := s.do(t, http.MethodGet, "/api/admin/libraries/lib-a/users", nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("list library users: got %d", rec.Code)
	}
	users := decode(t, rec)["users"].([]any)
	if len(users) != 2 {
		t.Fatalf("library has %d users, want 2", len(users))
	}

	// validation: missing userIds key
	if rec := s.do(t, http.MethodPost, "/api/admin/libraries/lib-a/users", map[string]any{}, admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("assign without userIds: want 400, got %d", rec.Code)
	}

	// user direction: assign + list
	if rec := s.do(t, http.MethodPost, "/api/admin/users/u-1/libraries", map[string]any{"libraryIds": []string{"lib-b"}}, admin); rec.Code != http.StatusOK {
		t.Fatalf("assign libraries: want 200, got %d", rec.Code)
	}
	rec = s.do(t, http.MethodGet, "/api/admin/users/u-1/libraries", nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("list user libraries: got %d", rec.Code)
	}
	libs := decode(t, rec)["libraries"].([]any)
	if len(libs) != 2 || libs[0] != "lib-a" || libs[1] != "lib-b" {
		t.Fatalf("user libraries = %v, want [lib-a lib-b] (assignments are additive)", libs)
	}

	// removals, both directions
	if rec := s.do(t, http.MethodDelete, "/api/admin/libraries/lib-a/users/u-2", nil, admin); rec.Code != http.StatusOK {
		t.Fatalf("remove user: want 200, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/admin/users/u-1/libraries/lib-b", nil, admin); rec.Code != http.StatusOK {
		t.Fatalf("remove library: want 200, got %d", rec.Code)
	}
	rec = s.do(t, http.MethodGet, "/api/admin/libraries/lib-a/users", nil, admin)
	if users := decode(t, rec)["users"].([]any); len(users) != 1 || users[0] != "u-1" {
		t.Fatalf("after removal: users = %v", users)
	}

	// Non-admin cannot touch assignments.
	user := s.session(t, "u-1", "one", false)
	if rec := s.do(t, http.MethodGet, "/api/admin/libraries/lib-a/users", nil, user); rec.Code != http.StatusForbidden {
		t.Fatalf("user assignments: want 403, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPost, "/api/admin/users/u-1/libraries", map[string]any{"libraryIds": []string{"lib-a"}}, user); rec.Code != http.StatusForbidden {
		t.Fatalf("user assign: want 403, got %d", rec.Code)
	}
}
