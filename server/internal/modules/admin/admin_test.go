// Admin surface tests: system-tasks definitions/run/history, the status
// dashboard, missing-file management, and ingest runs.
package admin_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/admin"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type server struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
	queue  *library.Queue
}

func newServer(t *testing.T) *server {
	t.Helper()
	return newServerWithIntervals(t, admin.TaskIntervals{
		ScanInterval:        time.Hour,
		ArtistImageInterval: 24 * time.Hour,
		IngestInterval:      time.Hour,
		IngestPath:          "/ingest",
	})
}

func newServerWithIntervals(t *testing.T, intervals admin.TaskIntervals) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	queue := library.NewQueue(database)
	r := chi.NewRouter()
	admin.NewHandler(admin.NewService(database, queue, intervals), mw).Routes(r)
	return &server{db: database, store: store, router: r, queue: queue}
}

func (s *server) do(t *testing.T, method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
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

func TestAdminRoutesRequireAdmin(t *testing.T) {
	s := newServer(t)
	paths := []struct {
		method, path string
	}{
		{http.MethodGet, "/api/admin/system-tasks"},
		{http.MethodGet, "/api/admin/system-tasks/history"},
		{http.MethodPost, "/api/admin/system-tasks/periodic_scan/run"},
		{http.MethodGet, "/api/admin/status"},
		{http.MethodGet, "/api/admin/missing"},
		{http.MethodDelete, "/api/admin/missing/songs/x"},
		{http.MethodGet, "/api/admin/ingest-runs"},
		{http.MethodDelete, "/api/admin/ingest-runs"},
	}
	for _, p := range paths {
		if rec := s.do(t, p.method, p.path, nil); rec.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s %s: want 401, got %d", p.method, p.path, rec.Code)
		}
		user := s.session(t, "u-user", "user", false)
		if rec := s.do(t, p.method, p.path, user); rec.Code != http.StatusForbidden {
			t.Fatalf("user %s %s: want 403, got %d", p.method, p.path, rec.Code)
		}
	}
}

func TestSystemTasksList(t *testing.T) {
	s := newServer(t)
	adminCookie := s.session(t, "u-admin", "admin", true)

	// Seed a completed scan job so the periodic_scan task has a status.
	jobID, err := s.queue.Push(context.Background(), library.JobTypeScan, library.ScanPayload{})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.queue.MarkCompleted(context.Background(), jobID, map[string]any{"added": 3}); err != nil {
		t.Fatal(err)
	}

	rec := s.do(t, http.MethodGet, "/api/admin/system-tasks", adminCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	tasks := decode(t, rec)["tasks"].([]any)
	if len(tasks) != 4 {
		t.Fatalf("tasks = %d, want 4", len(tasks))
	}
	byID := map[string]map[string]any{}
	for _, item := range tasks {
		task := item.(map[string]any)
		byID[task["id"].(string)] = task
		if task["name"] == "" || task["description"] == "" {
			t.Fatalf("task missing fields: %v", task)
		}
	}
	scan := byID["periodic_scan"]
	if scan == nil || scan["intervalMinutes"] != float64(60) {
		t.Fatalf("periodic_scan = %v", scan)
	}
	if scan["status"] != "completed" {
		t.Fatalf("periodic_scan status = %v", scan["status"])
	}
	if byID["review_cleanup"]["intervalMinutes"] != float64(24*60) {
		t.Fatalf("review_cleanup = %v", byID["review_cleanup"])
	}
	if byID["artist_images"]["intervalMinutes"] != float64(24*60) {
		t.Fatalf("artist_images = %v", byID["artist_images"])
	}

	// A disabled interval surfaces as null.
	s2 := newServerWithIntervals(t, admin.TaskIntervals{ScanInterval: -1})
	admin2 := s2.session(t, "u-admin", "admin", true)
	rec = s2.do(t, http.MethodGet, "/api/admin/system-tasks", admin2)
	scan = nil
	for _, item := range decode(t, rec)["tasks"].([]any) {
		task := item.(map[string]any)
		if task["id"] == "periodic_scan" {
			scan = task
		}
	}
	if scan == nil {
		t.Fatal("periodic_scan missing")
	}
	if interval, present := scan["intervalMinutes"]; present && interval != nil {
		t.Fatalf("disabled interval must be null, got %v", interval)
	}
}

func TestSystemTaskRun(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	if rec := s.do(t, http.MethodPost, "/api/admin/system-tasks/bogus/run", admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad task id: want 400, got %d", rec.Code)
	}
	rec := s.do(t, http.MethodPost, "/api/admin/system-tasks/periodic_scan/run", admin)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("run: want 202, got %d", rec.Code)
	}
	var pending int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM scan_jobs WHERE type = 'scan' AND status = 'pending'`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("pending scan jobs = %d, want 1", pending)
	}

	rec = s.do(t, http.MethodPost, "/api/admin/system-tasks/ingest/run", admin)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("ingest run: want 202, got %d", rec.Code)
	}
	var ingestPayload string
	if err := s.db.QueryRow(
		`SELECT payload FROM scan_jobs WHERE type = 'ingest' AND status = 'pending'`).Scan(&ingestPayload); err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(ingestPayload), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["sourcePath"] != "/ingest" {
		t.Fatalf("ingest payload = %v", decoded)
	}
}

func TestSystemTaskHistoryPagination(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	// Seed 12 completed jobs of mixed system types plus one non-system row.
	for i := 0; i < 12; i++ {
		jobType := []library.JobType{library.JobTypeScan, library.JobTypeResync, library.JobTypeIngest}[i%3]
		jobID, err := s.queue.Push(context.Background(), jobType, library.ScanPayload{})
		if err != nil {
			t.Fatal(err)
		}
		if err := s.queue.MarkCompleted(context.Background(), jobID, map[string]any{"i": i}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(
		`INSERT INTO scan_jobs (id, type, status, created_at) VALUES ('non-system', 'organize', 'pending', datetime('now'))`); err != nil {
		t.Fatal(err)
	}

	// Page 1: default limit 10, total 12, totalPages 2.
	rec := s.do(t, http.MethodGet, "/api/admin/system-tasks/history", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	page := decode(t, rec)
	if page["page"] != float64(1) || page["limit"] != float64(10) ||
		page["total"] != float64(12) || page["totalPages"] != float64(2) {
		t.Fatalf("page meta = %v", page)
	}
	history := page["history"].([]any)
	if len(history) != 10 {
		t.Fatalf("history rows = %d, want 10", len(history))
	}
	// The organize job must not leak into the system history.
	for _, item := range history {
		entry := item.(map[string]any)
		if entry["type"] == "organize" {
			t.Fatal("non-system job in history")
		}
		if entry["task"] == "" || entry["id"] == "" {
			t.Fatalf("entry missing fields: %v", entry)
		}
		if stats, ok := entry["stats"].(map[string]any); !ok || stats["i"] == nil {
			t.Fatalf("entry stats missing: %v", entry)
		}
	}

	// Page 2 gets the remaining 2; limit clamps.
	rec = s.do(t, http.MethodGet, "/api/admin/system-tasks/history?page=2&limit=5", admin)
	page = decode(t, rec)
	if page["limit"] != float64(5) || page["totalPages"] != float64(3) {
		t.Fatalf("page 2 meta = %v", page)
	}
	if history := page["history"].([]any); len(history) != 5 {
		t.Fatalf("page 2 rows = %d, want 5", len(history))
	}
	// limit > 100 clamps to 100.
	rec = s.do(t, http.MethodGet, "/api/admin/system-tasks/history?limit=500", admin)
	if decode(t, rec)["limit"] != float64(100) {
		t.Fatalf("limit clamp: %v", decode(t, rec)["limit"])
	}
}

func TestAdminStatus(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	s.seedCatalog(t)

	rec := s.do(t, http.MethodGet, "/api/admin/status", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	status := decode(t, rec)
	counts := status["counts"].(map[string]any)
	// v1 counts every row (active and inactive); the missingCounts carry the
	// inactive breakdown.
	if counts["users"] != float64(1) || counts["songs"] != float64(2) ||
		counts["albums"] != float64(2) || counts["artists"] != float64(2) {
		t.Fatalf("counts = %v", counts)
	}
	missing := status["missingCounts"].(map[string]any)
	if missing["songs"] != float64(1) || missing["albums"] != float64(1) || missing["artists"] != float64(1) {
		t.Fatalf("missing = %v", missing)
	}
	if status["ingestJobsCount"] != float64(1) {
		t.Fatalf("ingestJobsCount = %v", status["ingestJobsCount"])
	}
	latest, ok := status["latestIngest"].(map[string]any)
	if !ok || latest["status"] != "completed" {
		t.Fatalf("latestIngest = %v", status["latestIngest"])
	}
}

func (s *server) seedCatalog(t *testing.T) {
	t.Helper()
	exec := func(q string, args ...any) {
		if _, err := s.db.Exec(q, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	exec(`INSERT INTO artists (id, name, active) VALUES ('ar-1', 'Active Artist', 1), ('ar-2', 'Gone Artist', 0)`)
	exec(`INSERT INTO albums (id, name, active) VALUES ('al-1', 'Active Album', 1), ('al-2', 'Gone Album', 0)`)
	exec(`INSERT INTO songs (id, title, file_path, active, album_id, artist_id, mtime, checksum)
		VALUES ('so-1', 'Active Song', '/music/a.mp3', 1, 'al-1', 'ar-1', 1, 'c1'),
		       ('so-2', 'Gone Song', '/music/gone.mp3', 0, 'al-2', 'ar-2', 1, 'c2')`)
	exec(`INSERT INTO ingest_jobs (id, source_path, status, created_at, updated_at)
		VALUES ('ij-1', '/ingest/x.mp3', 'done', datetime('now'), datetime('now'))`)
	jobID, err := s.queue.Push(context.Background(), library.JobTypeIngest, library.IngestPayload{SourcePath: "/ingest"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.queue.MarkCompleted(context.Background(), jobID, map[string]any{"added": 1}); err != nil {
		t.Fatal(err)
	}
}

func TestMissingManagement(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	s.seedCatalog(t)

	rec := s.do(t, http.MethodGet, "/api/admin/missing", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	out := decode(t, rec)
	if songs := out["songs"].([]any); len(songs) != 1 || songs[0].(map[string]any)["title"] != "Gone Song" {
		t.Fatalf("missing songs = %v", songs)
	}
	if albums := out["albums"].([]any); len(albums) != 1 {
		t.Fatalf("missing albums = %v", albums)
	}
	if artists := out["artists"].([]any); len(artists) != 1 {
		t.Fatalf("missing artists = %v", artists)
	}

	// Single deletes.
	if rec := s.do(t, http.MethodDelete, "/api/admin/missing/songs/so-2", admin); rec.Code != http.StatusOK {
		t.Fatalf("delete missing song: got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/admin/missing/songs/so-2", admin); rec.Code != http.StatusNotFound {
		t.Fatalf("delete missing song twice: want 404, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/admin/missing/albums/al-2", admin); rec.Code != http.StatusOK {
		t.Fatalf("delete missing album: got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/admin/missing/artists/ar-2", admin); rec.Code != http.StatusOK {
		t.Fatalf("delete missing artist: got %d", rec.Code)
	}

	// Bulk deletes clear the rest (none left after the singles).
	rec = s.do(t, http.MethodDelete, "/api/admin/missing/songs", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("bulk songs: got %d", rec.Code)
	}
	rec = s.do(t, http.MethodGet, "/api/admin/missing", admin)
	out = decode(t, rec)
	if songs := out["songs"].([]any); len(songs) != 0 {
		t.Fatalf("after bulk: %v", songs)
	}
}

func TestIngestRuns(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	s.seedCatalog(t)

	// One completed ingest run exists from the seed.
	rec := s.do(t, http.MethodGet, "/api/admin/ingest-runs", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: got %d", rec.Code)
	}
	runs := decode(t, rec)["runs"].([]any)
	if len(runs) != 1 {
		t.Fatalf("runs = %d, want 1", len(runs))
	}
	runID := runs[0].(map[string]any)["id"].(string)

	// Detail: the per-file job from the seed has no run_id but falls inside
	// the run window (v1's created_at fallback).
	rec = s.do(t, http.MethodGet, "/api/admin/ingest-runs/"+runID, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail: got %d", rec.Code)
	}
	detail := decode(t, rec)
	if detail["id"] != runID {
		t.Fatalf("detail id = %v", detail["id"])
	}
	jobs, ok := detail["jobs"].([]any)
	if !ok || len(jobs) != 1 {
		t.Fatalf("detail jobs = %v", detail["jobs"])
	}
	if jobs[0].(map[string]any)["sourcePath"] != "/ingest/x.mp3" {
		t.Fatalf("job = %v", jobs[0])
	}

	if rec := s.do(t, http.MethodGet, "/api/admin/ingest-runs/nope", admin); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown run: want 404, got %d", rec.Code)
	}

	// Delete one, then all.
	if rec := s.do(t, http.MethodDelete, "/api/admin/ingest-runs/nope", admin); rec.Code != http.StatusNotFound {
		t.Fatalf("delete unknown: want 404, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/admin/ingest-runs/"+runID, admin); rec.Code != http.StatusOK {
		t.Fatalf("delete run: got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/admin/ingest-runs", admin); rec.Code != http.StatusOK {
		t.Fatalf("delete all: got %d", rec.Code)
	}
	var runsLeft, jobsLeft int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM scan_jobs WHERE type = 'ingest'`).Scan(&runsLeft); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM ingest_jobs`).Scan(&jobsLeft); err != nil {
		t.Fatal(err)
	}
	if runsLeft != 0 || jobsLeft != 0 {
		t.Fatalf("leftover runs=%d jobs=%d", runsLeft, jobsLeft)
	}
}
