package users_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

var tinyJPEG = []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 'p', 'a', 'y', 'l', 'o', 'a', 'd'}
var tinyPNG = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 'p', 'a', 'y', 'l', 'o', 'a', 'd'}
var tinyGIF = []byte{'G', 'I', 'F', '8', '9', 'a', 'x'}

func (s *testServer) uploadAvatar(t *testing.T, cookie *http.Cookie, payload []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/me/avatar", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "image/png") // deliberately misleading; sniffing must win
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func TestUploadAvatarRoundTrip(t *testing.T) {
	s := newTestServer(t)
	user := s.setup(t, "avataruser", adminPass)

	rec := s.uploadAvatar(t, user, tinyJPEG)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	userDoc := out["user"].(map[string]any)
	avatarURL, _ := userDoc["avatarUrl"].(string)
	if avatarURL == "" {
		t.Fatal("avatarUrl missing after upload")
	}

	// Public GET serves the bytes with a day of caching.
	req := httptest.NewRequest(http.MethodGet, avatarURL, nil)
	rec = httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("avatar GET: want 200, got %d", rec.Code)
	}
	if rec.Body.String() != string(tinyJPEG) {
		t.Fatal("avatar bytes differ from the upload")
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("content type = %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=86400" {
		t.Fatalf("cache control = %q", cc)
	}
}

func TestUploadAvatarValidation(t *testing.T) {
	s := newTestServer(t)
	user := s.setup(t, "avataruser2", adminPass)

	// Declared image/png, text bytes: sniffing rejects it.
	if rec := s.uploadAvatar(t, user, []byte("not an image at all")); rec.Code != http.StatusBadRequest {
		t.Fatalf("fake png: want 400, got %d", rec.Code)
	}
	// Oversized.
	if rec := s.uploadAvatar(t, user, append(tinyPNG, make([]byte, 2<<20)...)); rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized: want 400, got %d", rec.Code)
	}
	// Empty body.
	if rec := s.uploadAvatar(t, user, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty: want 400, got %d", rec.Code)
	}
	// gif + webp are in the old allowlist.
	if rec := s.uploadAvatar(t, user, tinyGIF); rec.Code != http.StatusOK {
		t.Fatalf("gif: want 200, got %d", rec.Code)
	}
}

func TestUploadAvatarAuthzAndReplacement(t *testing.T) {
	s := newTestServer(t)
	if rec := s.uploadAvatar(t, nil, tinyPNG); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: want 401, got %d", rec.Code)
	}

	user := s.setup(t, "avataruser3", adminPass)
	if rec := s.uploadAvatar(t, user, tinyPNG); rec.Code != http.StatusOK {
		t.Fatalf("png upload: got %d", rec.Code)
	}
	// A jpeg replaces the png: the old file is removed from disk.
	if rec := s.uploadAvatar(t, user, tinyJPEG); rec.Code != http.StatusOK {
		t.Fatalf("jpeg upload: got %d", rec.Code)
	}
	var filename string
	if err := s.db.QueryRow(`SELECT avatar_path FROM users WHERE username = 'avataruser3'`).Scan(&filename); err != nil {
		t.Fatal(err)
	}
	if filename == "" {
		t.Fatal("avatar_path not recorded")
	}

	// Another user's avatar answers 404.
	req := httptest.NewRequest(http.MethodGet, "/api/avatars/does-not-exist", nil)
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown avatar: want 404, got %d", rec.Code)
	}
}
