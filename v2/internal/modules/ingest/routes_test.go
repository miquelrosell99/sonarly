// HTTP-level tests: ingest management routes (list/get/delete/wipe/trigger),
// the trigger's end-to-end execution through the real worker loop, conflict
// listing and the file-then-row deletion, and the authorization matrix
// (anonymous 401, non-admin 403).
package ingest_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
)

const routeSecret = "0123456789abcdef0123456789abcdef"

type routeServer struct {
	db        *sql.DB
	store     *auth.Store
	router    http.Handler
	svc       *ingest.Service
	queue     *library.Queue
	worker    *library.Worker
	dataDir   string
	ingestDir string
	library   string
	libraryID string
}

func newRouteServer(t *testing.T) *routeServer {
	t.Helper()
	ctx := context.Background()
	database, err := db.OpenInMemory(ctx)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	s := &routeServer{db: database}
	s.dataDir = t.TempDir()
	s.ingestDir = t.TempDir()
	s.library = t.TempDir()
	s.libraryID = uuid.NewString()
	addLibrary(t, database, s.libraryID, s.library, library.DefaultOrganizePattern)

	s.store = auth.NewStore(database)
	mw := auth.NewMiddleware(s.store, database, routeSecret, false)
	s.queue = library.NewQueue(database)
	s.svc = ingest.NewService(database, discardLogger(), s.queue, ingest.Options{
		IngestPath:          s.ingestDir,
		LibraryPath:         s.library,
		ReviewRetentionDays: 30,
	})
	s.worker = library.NewWorker(s.queue, library.NewScanner(database, discardLogger(), s.library), discardLogger())
	s.worker.Register(library.JobTypeIngest, s.svc.RunIngestJob)
	s.worker.Register(library.JobTypeOrganize, s.svc.RunOrganizeJob)
	s.worker.Register(library.JobTypeCleanupReview, s.svc.RunReviewCleanupJob)

	r := chi.NewRouter()
	ingest.NewHandler(s.svc, mw, s.ingestDir).Routes(r)
	s.router = r
	return s
}

func (s *routeServer) do(t *testing.T, method, path string, body []byte, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func (s *routeServer) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
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
	auth.WriteSessionCookie(rec, routeSecret, false, sid)
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

func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response %q: %v", rec.Body.String(), err)
	}
	return out
}

func waitFor(t *testing.T, timeout time.Duration, msg string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", msg)
}

func TestIngestJobRoutes(t *testing.T) {
	s := newRouteServer(t)
	admin := s.session(t, "admin-1", "admin", true)
	user := s.session(t, "user-1", "user", false)

	// Seed one ingest_jobs row directly.
	if _, err := s.db.Exec(
		`INSERT INTO ingest_jobs (id, run_id, source_path, status) VALUES ('job-1', 'run-1', '/tmp/x.mp3', 'imported')`); err != nil {
		t.Fatalf("seed job: %v", err)
	}

	// Anonymous reads are 401; authenticated reads list jobs.
	if rec := s.do(t, "GET", "/api/ingest", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous GET /api/ingest = %d, want 401", rec.Code)
	}
	rec := s.do(t, "GET", "/api/ingest", nil, user)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/ingest = %d", rec.Code)
	}
	jobs := decodeJSON(t, rec)["jobs"].([]any)
	if len(jobs) != 1 {
		t.Fatalf("jobs = %d, want 1", len(jobs))
	}

	rec = s.do(t, "GET", "/api/ingest/job-1", nil, user)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/ingest/job-1 = %d", rec.Code)
	}
	if job := decodeJSON(t, rec)["job"].(map[string]any); job["id"] != "job-1" || job["status"] != "imported" {
		t.Errorf("job = %v", job)
	}
	if rec := s.do(t, "GET", "/api/ingest/nope", nil, user); rec.Code != http.StatusNotFound {
		t.Errorf("GET unknown job = %d, want 404", rec.Code)
	}

	// Deletes are admin-only.
	if rec := s.do(t, "DELETE", "/api/ingest/job-1", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous DELETE = %d, want 401", rec.Code)
	}
	if rec := s.do(t, "DELETE", "/api/ingest/job-1", nil, user); rec.Code != http.StatusForbidden {
		t.Errorf("user DELETE = %d, want 403", rec.Code)
	}
	if rec := s.do(t, "DELETE", "/api/ingest/job-1", nil, admin); rec.Code != http.StatusOK {
		t.Errorf("admin DELETE = %d", rec.Code)
	}
	if rec := s.do(t, "DELETE", "/api/ingest/job-1", nil, admin); rec.Code != http.StatusNotFound {
		t.Errorf("second DELETE = %d, want 404", rec.Code)
	}

	if _, err := s.db.Exec(
		`INSERT INTO ingest_jobs (id, source_path, status) VALUES ('job-2', '/tmp/y.mp3', 'failed')`); err != nil {
		t.Fatalf("seed job: %v", err)
	}
	if rec := s.do(t, "DELETE", "/api/ingest", nil, admin); rec.Code != http.StatusOK {
		t.Errorf("admin wipe = %d", rec.Code)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM ingest_jobs`).Scan(&n); err != nil || n != 0 {
		t.Errorf("ingest_jobs after wipe = %d (err %v)", n, err)
	}
}

// TestTriggerRouteEndToEnd pushes a job through the HTTP route and executes
// it through the real worker loop: the file lands in the library, the
// scan_jobs row completes, and exactly one typed job exists.
func TestTriggerRouteEndToEnd(t *testing.T) {
	s := newRouteServer(t)
	admin := s.session(t, "admin-1", "admin", true)

	drop := filepath.Join(s.ingestDir, s.libraryID)
	corpusCopy(t, drop, "spike.mp3", "upload.mp3")

	// Trigger for the explicit library.
	body, _ := json.Marshal(map[string]string{"libraryId": s.libraryID})
	rec := s.do(t, "POST", "/api/ingest/trigger", body, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("trigger = %d: %s", rec.Code, rec.Body.String())
	}

	var jobType, jobStatus string
	if err := s.db.QueryRow(`SELECT type, status FROM scan_jobs LIMIT 1`).Scan(&jobType, &jobStatus); err != nil {
		t.Fatalf("scan_jobs row: %v", err)
	}
	if jobType != "ingest" {
		t.Fatalf("job type = %q, want ingest", jobType)
	}

	// Exactly one job, with the typed payload pointing at this library's
	// drop dir.
	var payload string
	var jobCount int
	if err := s.db.QueryRow(`SELECT COUNT(1), COALESCE(MAX(payload), '') FROM scan_jobs`).Scan(&jobCount, &payload); err != nil {
		t.Fatalf("count scan jobs: %v", err)
	}
	if jobCount != 1 {
		t.Fatalf("scan_jobs count = %d, want exactly 1", jobCount)
	}
	var typed library.IngestPayload
	if err := json.Unmarshal([]byte(payload), &typed); err != nil {
		t.Fatalf("payload not typed: %v", err)
	}
	if typed.LibraryID != s.libraryID || typed.SourcePath != drop {
		t.Errorf("payload = %+v, want library %s drop %s", typed, s.libraryID, drop)
	}

	// Run the job through the worker loop and watch it complete.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.worker.Start(ctx)
	waitFor(t, 10*time.Second, "ingest job to complete", func() bool {
		var status string
		_ = s.db.QueryRow(`SELECT status FROM scan_jobs LIMIT 1`).Scan(&status)
		return status == "completed"
	})
	cancel()

	wantPath := filepath.Join(s.library, "Spike Album Artist", "(2021) Spike Album", "0103 - Spike Song (feat. Test).mp3")
	if !fileExists(wantPath) {
		t.Errorf("file not organized to %s", wantPath)
	}
	if n := countRows(t, s.db, `SELECT COUNT(1) FROM ingest_jobs WHERE status = 'imported' AND run_id IN (SELECT id FROM scan_jobs)`); n != 1 {
		t.Errorf("ingest_jobs imported rows = %d, want 1", n)
	}
}

func TestTriggerRouteValidation(t *testing.T) {
	s := newRouteServer(t)
	admin := s.session(t, "admin-1", "admin", true)
	user := s.session(t, "user-1", "user", false)

	if rec := s.do(t, "POST", "/api/ingest/trigger", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous trigger = %d, want 401", rec.Code)
	}
	if rec := s.do(t, "POST", "/api/ingest/trigger", nil, user); rec.Code != http.StatusForbidden {
		t.Errorf("user trigger = %d, want 403", rec.Code)
	}
	if rec := s.do(t, "POST", "/api/ingest/trigger", []byte("{bad json"), admin); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed body = %d, want 400", rec.Code)
	}
	bad, _ := json.Marshal(map[string]string{"libraryId": "not-a-uuid"})
	if rec := s.do(t, "POST", "/api/ingest/trigger", bad, admin); rec.Code != http.StatusBadRequest {
		t.Errorf("non-uuid libraryId = %d, want 400", rec.Code)
	}
	unknown, _ := json.Marshal(map[string]string{"libraryId": uuid.NewString()})
	if rec := s.do(t, "POST", "/api/ingest/trigger", unknown, admin); rec.Code != http.StatusNotFound {
		t.Errorf("unknown library = %d, want 404", rec.Code)
	}

	// No libraryId: the default library is used and its drop dir created.
	rec := s.do(t, "POST", "/api/ingest/trigger", []byte("{}"), admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("default trigger = %d: %s", rec.Code, rec.Body.String())
	}
	var payload string
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(1), COALESCE(MAX(payload), '') FROM scan_jobs`).Scan(&count, &payload); err != nil {
		t.Fatalf("scan jobs: %v", err)
	}
	if count != 1 {
		t.Fatalf("scan_jobs = %d, want 1", count)
	}
	var typed library.IngestPayload
	if err := json.Unmarshal([]byte(payload), &typed); err != nil {
		t.Fatalf("payload not typed: %v", err)
	}
	if typed.LibraryID != s.libraryID {
		t.Errorf("default trigger payload library = %q, want %q", typed.LibraryID, s.libraryID)
	}
	if !fileExists(filepath.Join(s.ingestDir, s.libraryID)) {
		t.Error("drop dir was not bootstrapped")
	}
}

func TestConflictRoutes(t *testing.T) {
	s := newRouteServer(t)
	admin := s.session(t, "admin-1", "admin", true)
	user := s.session(t, "user-1", "user", false)

	// A song parked on a collision path — plus a decoy whose path merely
	// contains " (...)" without the suffix shape (must NOT be listed).
	collisionDir := filepath.Join(s.library, "Artist", "Album")
	if err := os.MkdirAll(collisionDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	collisionFile := writeFile(t, filepath.Join(collisionDir, "Song (1).mp3"), "audio")
	decoyFile := writeFile(t, filepath.Join(collisionDir, "Song (draft).mp3"), "audio")
	if _, err := s.db.Exec(
		`INSERT INTO songs (id, file_path, title, mtime, checksum, active) VALUES ('song-1', ?, 'Song', 1, 'x', 1)`, collisionFile); err != nil {
		t.Fatalf("insert song: %v", err)
	}
	if _, err := s.db.Exec(
		`INSERT INTO songs (id, file_path, title, mtime, checksum, active) VALUES ('song-2', ?, 'Decoy', 1, 'y', 1)`, decoyFile); err != nil {
		t.Fatalf("insert decoy: %v", err)
	}

	if rec := s.do(t, "GET", "/api/conflicts", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous GET conflicts = %d, want 401", rec.Code)
	}
	if rec := s.do(t, "GET", "/api/conflicts", nil, user); rec.Code != http.StatusForbidden {
		t.Errorf("user GET conflicts = %d, want 403", rec.Code)
	}
	rec := s.do(t, "GET", "/api/conflicts", nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET conflicts = %d", rec.Code)
	}
	conflicts := decodeJSON(t, rec)["conflicts"].([]any)
	if len(conflicts) != 1 {
		t.Fatalf("conflicts = %d, want 1 (decoy filtered out)", len(conflicts))
	}
	entry := conflicts[0].(map[string]any)
	if entry["id"] != "song-1" || entry["filePath"] != collisionFile {
		t.Errorf("conflict entry = %v", entry)
	}

	if rec := s.do(t, "DELETE", "/api/conflicts", nil, user); rec.Code != http.StatusForbidden {
		t.Errorf("user DELETE conflicts = %d, want 403", rec.Code)
	}
	rec = s.do(t, "DELETE", "/api/conflicts", nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE conflicts = %d", rec.Code)
	}
	if deleted := decodeJSON(t, rec)["deleted"].(float64); deleted != 1 {
		t.Errorf("deleted = %v, want 1", deleted)
	}

	// v1 B5: the FILE went first and the row followed — assert BOTH.
	if fileExists(collisionFile) {
		t.Error("conflict file survived deletion")
	}
	if n := countRows(t, s.db, `SELECT COUNT(1) FROM songs WHERE id = 'song-1'`); n != 0 {
		t.Error("conflict song row survived deletion")
	}
	// The decoy is untouched.
	if !fileExists(decoyFile) {
		t.Error("decoy file was deleted")
	}
	if n := countRows(t, s.db, `SELECT COUNT(1) FROM songs WHERE id = 'song-2'`); n != 1 {
		t.Error("decoy row was deleted")
	}
}
