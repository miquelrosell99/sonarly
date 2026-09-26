package users_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// getPreferences decodes a GET /api/me/preferences response.
func (s *testServer) getPreferences(t *testing.T, ck *http.Cookie) map[string]any {
	t.Helper()
	rec := s.do(t, http.MethodGet, "/api/me/preferences", nil, ck)
	if rec.Code != http.StatusOK {
		t.Fatalf("get preferences: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Preferences map[string]any `json:"preferences"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Preferences
}

func TestGetPreferencesDefaults(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)

	prefs := s.getPreferences(t, admin)
	// The shared defaults ride along even with no stored row (v1 parity).
	if prefs["autoDjEnabled"] != false || prefs["autoDjMode"] != "smart" {
		t.Fatalf("defaults missing: %v", prefs)
	}
	if prefs["autoDjTopUpThreshold"] != float64(5) || prefs["autoDjBatchSize"] != float64(10) {
		t.Fatalf("auto-dj defaults wrong: %v", prefs)
	}
	if prefs["autoDjExcludeWindow"] != "24h" || prefs["autoDjDiscovery"] != float64(50) {
		t.Fatalf("auto-dj defaults wrong: %v", prefs)
	}
}

func TestPatchPreferencesMergesAndValidates(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)

	rec := s.do(t, http.MethodPatch, "/api/me/preferences", map[string]any{
		"autoDjEnabled":        true,
		"autoDjMode":           "similar",
		"autoDjTopUpThreshold": 99, // clamped to 20 like v1
		"autoDjBatchSize":      0,  // clamped to 1
		"themeMode":            "oled",
		"accentColor":          "purple",
		"hideSponsorButton":    true,
	}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Preferences map[string]any `json:"preferences"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	prefs := out.Preferences
	if prefs["autoDjEnabled"] != true || prefs["autoDjMode"] != "similar" {
		t.Fatalf("patched values: %v", prefs)
	}
	if prefs["autoDjTopUpThreshold"] != float64(20) {
		t.Fatalf("threshold clamp = %v, want 20", prefs["autoDjTopUpThreshold"])
	}
	if prefs["autoDjBatchSize"] != float64(1) {
		t.Fatalf("batch clamp = %v, want 1", prefs["autoDjBatchSize"])
	}
	if prefs["themeMode"] != "oled" || prefs["accentColor"] != "purple" {
		t.Fatalf("theme patch: %v", prefs)
	}
	if prefs["autoDjDiscovery"] != float64(50) {
		t.Fatalf("untouched defaults must survive: %v", prefs)
	}

	// The merge persisted: a fresh GET sees the patch, and a second patch
	// layers on top (stored blob wins over defaults).
	prefs = s.getPreferences(t, admin)
	if prefs["themeMode"] != "oled" {
		t.Fatalf("patch did not persist: %v", prefs)
	}
	rec = s.do(t, http.MethodPatch, "/api/me/preferences",
		map[string]any{"autoDjDiscovery": 80}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("second patch: %d", rec.Code)
	}
	prefs = s.getPreferences(t, admin)
	if prefs["autoDjDiscovery"] != float64(80) || prefs["themeMode"] != "oled" {
		t.Fatalf("layered merge: %v", prefs)
	}

	// The blob really landed in the table.
	var blob string
	if err := s.db.QueryRow(`SELECT preferences FROM user_preferences`).Scan(&blob); err != nil {
		t.Fatal(err)
	}
	if blob == "" || blob == "{}" {
		t.Fatalf("empty blob stored: %q", blob)
	}
}

func TestPatchPreferencesAllowlistRejectsUnknownKeys(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)

	// Q8 mass-assignment fix: an unknown key is a 400, not a silent drop
	// (v1 ignored everything it didn't recognize — the frontend's theme
	// keys were silently lost on every save).
	rec := s.do(t, http.MethodPatch, "/api/me/preferences",
		map[string]any{"isAdmin": true}, admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown key: want 400, got %d", rec.Code)
	}
	if msg := errorField(t, rec); msg == "" {
		t.Fatalf("error message expected: %s", rec.Body.String())
	}

	// Nothing was stored.
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM user_preferences`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("rejected patch must not write")
	}

	// Known key + unknown key together: still rejected wholesale.
	rec = s.do(t, http.MethodPatch, "/api/me/preferences",
		map[string]any{"autoDjEnabled": true, "evil": 1}, admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mixed patch: want 400, got %d", rec.Code)
	}
}

func TestPatchPreferencesValueValidation(t *testing.T) {
	s := newTestServer(t)
	admin := s.setup(t, "admin", adminPass)

	cases := []struct {
		name string
		body map[string]any
	}{
		{"bool as string", map[string]any{"autoDjEnabled": "yes"}},
		{"threshold as string", map[string]any{"autoDjTopUpThreshold": "5"}},
		{"bad mode", map[string]any{"autoDjMode": "chaos"}},
		{"bad exclude window", map[string]any{"autoDjExcludeWindow": "1h"}},
		{"bad theme", map[string]any{"themeMode": "rainbow"}},
		{"bad accent", map[string]any{"accentColor": "magenta"}},
		{"sidebar not an object", map[string]any{"sidebar": "left"}},
		{"viewOptions not an object", map[string]any{"viewOptions": []any{}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := s.do(t, http.MethodPatch, "/api/me/preferences", tc.body, admin)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}

	// Structural objects pass through verbatim.
	rec := s.do(t, http.MethodPatch, "/api/me/preferences",
		map[string]any{"sidebar": map[string]any{"collapsedSections": []any{"playlists"}}}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("object patch: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPreferencesRequireAuth(t *testing.T) {
	s := newTestServer(t)
	if rec := s.do(t, http.MethodGet, "/api/me/preferences", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous GET: want 401, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPatch, "/api/me/preferences", map[string]any{}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous PATCH: want 401, got %d", rec.Code)
	}
}

func TestAvatarStubIs404(t *testing.T) {
	s := newTestServer(t)
	s.setup(t, "admin", adminPass)

	// The route exists (PublicUser.avatarUrl points at it); a user without
	// an avatar answers 404, anonymously too (v1 parity).
	if rec := s.do(t, http.MethodGet, "/api/avatars/any-id", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("anonymous avatar: want 404, got %d", rec.Code)
	}
	admin := s.login(t, "admin", adminPass)
	if rec := s.do(t, http.MethodGet, "/api/avatars/any-id", nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("authed avatar: want 404, got %d", rec.Code)
	}
}

func errorField(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var out struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out.Error
}
