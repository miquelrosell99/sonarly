// GET /api/users/lookup: any signed-in user searches for share recipients
// by username substring (LIKE-escaped, self excluded, capped).
package users_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// seedLookupUser inserts a user directly (password material is irrelevant
// to the lookup) and returns nothing.
func (s *testServer) seedLookupUser(t *testing.T, id, username string, name *string) {
	t.Helper()
	if _, err := s.db.Exec(
		`INSERT INTO users (id, username, password_hash, is_admin, created_at, name)
		 VALUES (?, ?, 'x', 0, datetime('now'), ?)`, id, username, name); err != nil {
		t.Fatalf("insert user: %v", err)
	}
}

// sessionFor mints a real session cookie for an existing user row.
func (s *testServer) sessionFor(t *testing.T, userID, username string) *http.Cookie {
	t.Helper()
	sid := auth.NewSID()
	if err := s.store.Create(context.Background(), sid, auth.Session{
		UserID: userID, Username: username, IsAdmin: false,
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, secret, false, sid)
	return rec.Result().Cookies()[0]
}

// decodeLookup reads the {users: [...]} envelope.
func decodeLookup(t *testing.T, rec *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	var out struct {
		Users []map[string]any `json:"users"`
	}
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out.Users
}

func seedLookupFixtures(t *testing.T, s *testServer) {
	t.Helper()
	names := map[string]*string{
		"u-alice": strPtr("Alice"),
		"u-bob":   nil,
	}
	users := []struct {
		id       string
		username string
	}{
		{"u-admin", "admin"},
		{"u-alice", "alice"},
		{"u-bob", "bob"},
		{"u-carol", "carol"},
		{"u-dave", "dave_100"},
		{"u-erin", "erin%star"},
	}
	for _, u := range users {
		s.seedLookupUser(t, u.id, u.username, names[u.id])
	}
}

func strPtr(s string) *string { return &s }

func TestLookup(t *testing.T) {
	s := newTestServer(t)
	seedLookupFixtures(t, s)
	// bob searches: alice matches the substring and is not the caller.
	bob := s.sessionFor(t, "u-bob", "bob")

	rec := s.do(t, http.MethodGet, "/api/users/lookup?q=ali", nil, bob)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeLookup(t, rec)
	if len(body) != 1 || body[0]["id"] != "u-alice" {
		t.Fatalf("hits: %v", body)
	}
	if body[0]["username"] != "alice" {
		t.Fatalf("username: %v", body[0])
	}
	if name, ok := body[0]["name"].(string); !ok || name != "Alice" {
		t.Fatalf("name must ride along: %v", body[0])
	}
}

func TestLookupExcludesSelf(t *testing.T) {
	s := newTestServer(t)
	seedLookupFixtures(t, s)
	// alice is the only "ali" — her own search must come back empty.
	alice := s.sessionFor(t, "u-alice", "alice")
	rec := s.do(t, http.MethodGet, "/api/users/lookup?q=ali", nil, alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if body := decodeLookup(t, rec); len(body) != 0 {
		t.Fatalf("self must be excluded: %v", body)
	}
}

func TestLookupExcludesSelfAndCaps(t *testing.T) {
	s := newTestServer(t)
	// Eleven matches; the cap must cut the list to 10 and drop the caller.
	s.seedLookupUser(t, "u-caller", "prefix_caller", nil)
	for i := 0; i < 10; i++ {
		s.seedLookupUser(t, fmt.Sprintf("u-%d", i), fmt.Sprintf("prefix_%02d", i), nil)
	}
	caller := s.sessionFor(t, "u-caller", "prefix_caller")

	rec := s.do(t, http.MethodGet, "/api/users/lookup?q=prefix", nil, caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := decodeLookup(t, rec)
	if len(body) != 10 {
		t.Fatalf("cap: want 10 hits, got %d", len(body))
	}
	for _, u := range body {
		if u["id"] == "u-caller" {
			t.Fatal("the caller must not appear in their own lookup")
		}
	}
}

func TestLookupEscapesLike(t *testing.T) {
	s := newTestServer(t)
	seedLookupFixtures(t, s)
	alice := s.sessionFor(t, "u-alice", "alice")

	// '%' and '_' are wildcards; searching for the literal strings must not
	// match every username.
	rec := s.do(t, http.MethodGet, "/api/users/lookup?q=%25", nil, alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if body := decodeLookup(t, rec); len(body) != 1 || body[0]["id"] != "u-erin" {
		t.Fatalf("literal %%: %v", body)
	}
	rec = s.do(t, http.MethodGet, "/api/users/lookup?q=_", nil, alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if body := decodeLookup(t, rec); len(body) != 1 || body[0]["id"] != "u-dave" {
		t.Fatalf("literal _: %v", body)
	}
}

func TestLookupNoQuery(t *testing.T) {
	s := newTestServer(t)
	seedLookupFixtures(t, s)
	alice := s.sessionFor(t, "u-alice", "alice")

	// An empty q lists users (caller excluded), username-ordered.
	rec := s.do(t, http.MethodGet, "/api/users/lookup", nil, alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := decodeLookup(t, rec)
	if len(body) != 5 {
		t.Fatalf("want the five other users, got %d", len(body))
	}
	for i := 1; i < len(body); i++ {
		if body[i-1]["username"].(string) >= body[i]["username"].(string) {
			t.Fatalf("not username-ordered: %v", body)
		}
	}
}

func TestLookupRequiresAuth(t *testing.T) {
	s := newTestServer(t)
	if rec := s.do(t, http.MethodGet, "/api/users/lookup?q=x", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}
