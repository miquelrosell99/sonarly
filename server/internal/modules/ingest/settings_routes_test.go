// Media settings and organize route tests: the GET/PATCH settings surface,
// the organize enqueue endpoints, the unauthenticated preview (v1 parity),
// and the per-job status route.
package ingest_test

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
	"github.com/miquelrosell99/sonarly/server/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

const settingsTestSecret = "0123456789abcdef0123456789abcdef"

type settingsServer struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
	queue  *library.Queue
}

func newSettingsServer(t *testing.T) *settingsServer {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, settingsTestSecret, false)
	queue := library.NewQueue(database)
	svc := ingest.NewService(database, discardLogger(), queue, ingest.Options{
		IngestPath:          t.TempDir(),
		LibraryPath:         t.TempDir(),
		ReviewRetentionDays: 30,
	})
	r := chi.NewRouter()
	ingest.NewHandler(svc, mw, t.TempDir()).Routes(r)
	return &settingsServer{db: database, store: store, router: r, queue: queue}
}

func (s *settingsServer) do(t *testing.T, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
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
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func (s *settingsServer) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
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
	auth.WriteSessionCookie(rec, settingsTestSecret, false, sid)
	return rec.Result().Cookies()[0]
}

func decodeSettings(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

func TestMediaSettingsAuthz(t *testing.T) {
	s := newSettingsServer(t)
	if rec := s.do(t, http.MethodGet, "/api/settings/media", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous GET: want 401, got %d", rec.Code)
	}
	user := s.session(t, "u-1", "user", false)
	if rec := s.do(t, http.MethodGet, "/api/settings/media", nil, user); rec.Code != http.StatusForbidden {
		t.Fatalf("user GET: want 403, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPatch, "/api/settings/media", map[string]any{"reviewRetentionDays": 7}, user); rec.Code != http.StatusForbidden {
		t.Fatalf("user PATCH: want 403, got %d", rec.Code)
	}
}

func TestMediaSettingsGetPatch(t *testing.T) {
	s := newSettingsServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	// GET: defaults plus the templates.
	rec := s.do(t, http.MethodGet, "/api/settings/media", nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET: want 200, got %d", rec.Code)
	}
	out := decodeSettings(t, rec)
	if out["organizePattern"] != library.DefaultOrganizePattern {
		t.Fatalf("default pattern = %v", out["organizePattern"])
	}
	if out["duplicateStrategy"] != "keep_file_replace_metadata" {
		t.Fatalf("default strategy = %v", out["duplicateStrategy"])
	}
	if out["reviewRetentionDays"] != float64(30) {
		t.Fatalf("default retention = %v", out["reviewRetentionDays"])
	}
	if templates := out["templates"].([]any); len(templates) != 6 {
		t.Fatalf("templates = %d, want 6", len(templates))
	}

	// PATCH each key and read them back through a fresh GET.
	rec = s.do(t, http.MethodPatch, "/api/settings/media", map[string]any{
		"organizePattern":     "{artist}/{title}",
		"duplicateStrategy":   "skip",
		"reviewRetentionDays": 7,
	}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	out = decodeSettings(t, rec)
	if out["organizePattern"] != "{artist}/{title}" || out["duplicateStrategy"] != "skip" ||
		out["reviewRetentionDays"] != float64(7) {
		t.Fatalf("patched = %v", out)
	}
	// PATCH answers without templates (v1 shape).
	if _, present := out["templates"]; present {
		t.Fatal("PATCH response must not carry templates")
	}
	rec = s.do(t, http.MethodGet, "/api/settings/media", nil, admin)
	if got := decodeSettings(t, rec)["duplicateStrategy"]; got != "skip" {
		t.Fatalf("GET after PATCH = %v", got)
	}

	// Validation.
	cases := []struct {
		name string
		body any
	}{
		{"absolute pattern", map[string]any{"organizePattern": "/etc/passwd"}},
		{"dotdot segment", map[string]any{"organizePattern": "{artist}/../{title}"}},
		{"bad strategy", map[string]any{"duplicateStrategy": "clobber"}},
		{"retention zero", map[string]any{"reviewRetentionDays": 0}},
		{"retention huge", map[string]any{"reviewRetentionDays": 366}},
		{"bad body", "not-an-object"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := s.do(t, http.MethodPatch, "/api/settings/media", tc.body, admin)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d", rec.Code)
			}
		})
	}
}

func TestOrganizeRoutes(t *testing.T) {
	s := newSettingsServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	// The preview is public (v1 parity).
	rec := s.do(t, http.MethodGet, "/api/organize/preview", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("preview: want 200, got %d", rec.Code)
	}
	if decodeSettings(t, rec)["pattern"] != library.DefaultOrganizePattern {
		t.Fatalf("preview = %v", decodeSettings(t, rec))
	}

	// Enqueue variants: 202 and 200, both enqueue an organize job.
	if rec := s.do(t, http.MethodPost, "/api/organize", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous organize: want 401, got %d", rec.Code)
	}
	user := s.session(t, "u-1", "user", false)
	if rec := s.do(t, http.MethodPost, "/api/organize", nil, user); rec.Code != http.StatusForbidden {
		t.Fatalf("user organize: want 403, got %d", rec.Code)
	}

	rec = s.do(t, http.MethodPost, "/api/organize", nil, admin)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("organize: want 202, got %d", rec.Code)
	}
	jobID := decodeSettings(t, rec)["jobId"].(string)
	if jobID == "" {
		t.Fatal("jobId missing")
	}

	rec = s.do(t, http.MethodPost, "/api/organize/job", nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("organize/job: want 200, got %d", rec.Code)
	}
	// Identical pending payloads coalesce (the P4b queue invariant).
	if decodeSettings(t, rec)["jobId"].(string) != jobID {
		t.Fatal("duplicate organize enqueue did not coalesce")
	}

	// Status: 404 for unknown ids, the job document for organize jobs.
	if rec := s.do(t, http.MethodGet, "/api/organize/status/nope", nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown status: want 404, got %d", rec.Code)
	}
	rec = s.do(t, http.MethodGet, "/api/organize/status/"+jobID, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	job := decodeSettings(t, rec)["job"].(map[string]any)
	if job["id"] != jobID || job["type"] != "organize" || job["status"] != "pending" {
		t.Fatalf("job = %v", job)
	}
	// A non-organize job id answers 404 (v1's type filter).
	scanID, err := s.queue.Push(context.Background(), library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatal(err)
	}
	if rec := s.do(t, http.MethodGet, "/api/organize/status/"+scanID, nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("scan id through organize status: want 404, got %d", rec.Code)
	}
}
