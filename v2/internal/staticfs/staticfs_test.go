package staticfs_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/v2/internal/staticfs"
)

// dist builds a temp web-dist with the standard build shape and returns its
// dir; the secret file lives OUTSIDE the dist so traversal attempts have
// something to reach for.
func dist(t *testing.T) (dir, secret string) {
	t.Helper()
	dir = t.TempDir()
	write(t, filepath.Join(dir, "index.html"), "<html>spa shell</html>")
	write(t, filepath.Join(dir, "app.js"), "console.log(1)")
	write(t, filepath.Join(dir, "assets", "app.a1b2c3.js"), "console.log(2)")

	outside := t.TempDir()
	secret = filepath.Join(outside, "secret.txt")
	write(t, secret, "top secret")
	return dir, secret
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// mountedRouter returns a router with one API route and the SPA fallback
// installed, matching the production wiring (fallback LAST, via NotFound).
func mountedRouter(t *testing.T, dir string) chi.Router {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/api/ping", func(w http.ResponseWriter, _ *http.Request) {
		httpserverJSON(w, `{"pong":true}`)
	})
	if err := staticfs.Mount(r, dir); err != nil {
		t.Fatalf("Mount: %v", err)
	}
	return r
}

func httpserverJSON(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(body))
}

func get(t *testing.T, h http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRootServesIndexHTML(t *testing.T) {
	dir, _ := dist(t)
	rec := get(t, mountedRouter(t, dir), "/")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache for the SPA shell", cc)
	}
	if !strings.Contains(rec.Body.String(), "spa shell") {
		t.Errorf("body = %q, want the index.html content", rec.Body.String())
	}
}

func TestExtensionlessDeepLinkServesIndexHTML(t *testing.T) {
	dir, _ := dist(t)
	for _, target := range []string{"/library", "/library/artist/some-uuid", "/settings/account"} {
		rec := get(t, mountedRouter(t, dir), target)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200 (SPA fallback)", target, rec.Code)
			continue
		}
		if !strings.Contains(rec.Body.String(), "spa shell") {
			t.Errorf("GET %s body = %q, want index.html", target, rec.Body.String())
		}
	}
}

func TestExistingFilesServedWithTypeAndCache(t *testing.T) {
	dir, _ := dist(t)
	r := mountedRouter(t, dir)

	rec := get(t, r, "/app.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /app.js = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("Content-Type = %q, want text/javascript", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "max-age=3600" {
		t.Errorf("Cache-Control = %q, want max-age=3600 for hashed-able assets", cc)
	}
	if rec.Body.String() != "console.log(1)" {
		t.Errorf("body = %q", rec.Body.String())
	}

	rec = get(t, r, "/assets/app.a1b2c3.js")
	if rec.Code != http.StatusOK || rec.Body.String() != "console.log(2)" {
		t.Errorf("GET content-hashed asset = %d body %q", rec.Code, rec.Body.String())
	}

	rec = get(t, r, "/nope.js")
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /nope.js = %d, want 404 (extension miss must not return HTML)", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "spa shell") {
		t.Errorf("missing .js returned the SPA shell")
	}
}

func TestAPIAndRestNeverIntercepted(t *testing.T) {
	dir, _ := dist(t)
	r := mountedRouter(t, dir)

	// Registered API routes still win over the fallback.
	rec := get(t, r, "/api/ping")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "pong") {
		t.Fatalf("GET /api/ping = %d body %q, want the API route untouched", rec.Code, rec.Body.String())
	}

	// Unmatched API-namespace paths keep the JSON 404 shape, not index.html.
	for _, target := range []string{"/api/nope", "/rest/getNope", "/api", "/rest"} {
		rec := get(t, r, target)
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", target, rec.Code)
			continue
		}
		var body map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Errorf("GET %s body = %q, want JSON error", target, rec.Body.String())
			continue
		}
		if body["error"] == "" {
			t.Errorf("GET %s error message empty", target)
		}
		if strings.Contains(rec.Body.String(), "spa shell") {
			t.Errorf("GET %s returned the SPA shell", target)
		}
	}
}

func TestTraversalContained(t *testing.T) {
	dir, secret := dist(t)
	r := mountedRouter(t, dir)

	for _, target := range []string{
		"/../secret.txt",
		"/%2e%2e/secret.txt",
		"/assets/../../secret.txt",
		"/..%2f..%2fsecret.txt",
	} {
		rec := get(t, r, target)
		raw, _ := os.ReadFile(secret)
		if rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), string(raw)) {
			t.Errorf("GET %s escaped the web-dist root", target)
			continue
		}
		if rec.Code == http.StatusOK {
			// A contained-but-missing file can only 200 via the SPA shell;
			// that is still a traversal-attempt answer, not the secret.
			if strings.Contains(rec.Body.String(), string(raw)) {
				t.Errorf("GET %s leaked %s", target, secret)
			}
		}
	}
}

func TestNonGetNotIntercepted(t *testing.T) {
	dir, _ := dist(t)
	r := mountedRouter(t, dir)
	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("POST /login = %d, want 404 (fallback is GET/HEAD only)", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "spa shell") {
		t.Errorf("POST /login returned the SPA shell")
	}
}

// TestMissingDirIsAPIMode pins the API-only behavior: with no web-dist the
// router keeps chi's default 404 for unmatched paths and matched API routes
// work exactly as before.
func TestMissingDirIsAPIMode(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "absent")
	r := mountedRouter(t, missing) // Mount must be a no-op, not an error

	rec := get(t, r, "/")
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET / = %d, want 404 in API-only mode", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "404 page not found") {
		t.Errorf("GET / body = %q, want chi's default 404 (unchanged current behavior)", rec.Body.String())
	}

	rec = get(t, r, "/api/ping")
	if rec.Code != http.StatusOK {
		t.Errorf("GET /api/ping = %d, want 200", rec.Code)
	}
}

func TestMountMissingDirNoError(t *testing.T) {
	if err := staticfs.Mount(chi.NewRouter(), filepath.Join(t.TempDir(), "absent")); err != nil {
		t.Errorf("Mount on missing dir = %v, want nil (API-only mode)", err)
	}
}

func TestNewFileNotDir(t *testing.T) {
	dir, _ := dist(t)
	if _, err := staticfs.New(filepath.Join(dir, "app.js")); err == nil {
		t.Error("New on a regular file: want error")
	}
}
