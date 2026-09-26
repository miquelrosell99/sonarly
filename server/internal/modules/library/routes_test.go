package library_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type scanServer struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
}

func newScanServer(t *testing.T, database *sql.DB) *scanServer {
	t.Helper()
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	r := chi.NewRouter()
	library.NewHandler(library.NewQueue(database), mw).Routes(r)
	return &scanServer{db: database, store: store, router: r}
}

func (s *scanServer) do(t *testing.T, method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func (s *scanServer) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
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
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one session cookie, got %d", len(cookies))
	}
	return cookies[0]
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

func TestScanRoutesRequireAuth(t *testing.T) {
	s := newScanServer(t, openDB(t))
	for _, method := range []string{http.MethodPost, http.MethodGet} {
		rec := s.do(t, method, "/api/scans", nil)
		if method == http.MethodGet {
			rec = s.do(t, method, "/api/scans/status", nil)
		} else {
			rec = s.do(t, method, "/api/scans", nil)
		}
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s: want 401, got %d", method, rec.Code)
		}
	}
}

func TestEnqueueScanRequiresAdmin(t *testing.T) {
	database := openDB(t)
	s := newScanServer(t, database)
	alice := s.session(t, "user-alice", "alice", false)

	rec := s.do(t, http.MethodPost, "/api/scans", alice)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin POST: want 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs`); got != 0 {
		t.Fatalf("forbidden POST must not enqueue: %d", got)
	}
}

func TestEnqueueScanCoalescesForAdmin(t *testing.T) {
	database := openDB(t)
	s := newScanServer(t, database)
	admin := s.session(t, "user-admin", "root", true)

	rec := s.do(t, http.MethodPost, "/api/scans", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["ok"] != true {
		t.Fatalf("response: %v", body)
	}
	jobID, ok := body["jobId"].(string)
	if !ok || jobID == "" {
		t.Fatalf("response must carry jobId: %v", body)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE status = 'pending'`); got != 1 {
		t.Fatalf("want 1 pending job, got %d", got)
	}

	// A second POST while the first is pending coalesces (Go-server fix: no
	// duplicate full scans from repeated admin clicks).
	rec = s.do(t, http.MethodPost, "/api/scans", admin)
	body = decodeBody(t, rec)
	if body["jobId"] != jobID {
		t.Fatalf("coalescing: want %q, got %v", jobID, body["jobId"])
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs`); got != 1 {
		t.Fatalf("want 1 job row, got %d", got)
	}
}

// The the retired server status bug: pending jobs (NULL started_at) sorted last, so the
// endpoint reported the previous finished job (or nothing) while a scan sat
// queued. The the Go server shape surfaces the queued job immediately.
func TestStatusShowsPendingJob(t *testing.T) {
	database := openDB(t)
	s := newScanServer(t, database)
	admin := s.session(t, "user-admin", "root", true)
	alice := s.session(t, "user-alice", "alice", false)

	rec := s.do(t, http.MethodPost, "/api/scans", admin)
	jobID := decodeBody(t, rec)["jobId"].(string)

	// Any authenticated user (not just admins) can read status — the old
	// web player polled it while streaming.
	rec = s.do(t, http.MethodGet, "/api/scans/status", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	job, ok := body["job"].(map[string]any)
	if !ok {
		t.Fatalf("status must include the pending job: %v", body)
	}
	if job["id"] != jobID {
		t.Fatalf("want pending job %q, got %v", jobID, job["id"])
	}
	if job["status"] != "pending" {
		t.Fatalf("want pending status, got %v", job["status"])
	}
	if job["type"] != "scan" {
		t.Fatalf("job type: %v", job["type"])
	}
	if _, ok := job["createdAt"].(string); !ok {
		t.Fatalf("pending job must carry createdAt: %v", job)
	}
	if _, hasStarted := job["startedAt"]; hasStarted {
		t.Fatalf("pending job must not have startedAt: %v", job)
	}
	if _, hasStats := job["stats"]; !hasStats {
		t.Fatalf("stats key must be present (null): %v", job)
	}
}

func TestStatusEmptyQueue(t *testing.T) {
	database := openDB(t)
	s := newScanServer(t, database)
	alice := s.session(t, "user-alice", "alice", false)

	rec := s.do(t, http.MethodGet, "/api/scans/status", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := decodeBody(t, rec)
	if body["job"] != nil {
		t.Fatalf("empty queue: want null job, got %v", body["job"])
	}
}
