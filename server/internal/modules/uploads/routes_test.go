// HTTP-level tests for the uploads module: protocol round trip, the
// validation matrix, the streaming-reassembly memory bound, and
// authorization. Sessions are real (SQLite :memory: + signed session
// cookie), files live in temp dirs, and the ingest target is a temp dir so
// the complete-session flow is observable end to end.

package uploads_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
	"github.com/miquelrosell99/sonarly/server/internal/modules/uploads"
)

const testSecret = "0123456789abcdef0123456789abcdef"

const corpusDir = "../../audio/testdata/corpus"

type uploadServer struct {
	db        *sql.DB
	store     *auth.Store
	router    http.Handler
	dataDir   string
	ingestDir string
}

func newUploadServer(t *testing.T) *uploadServer {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	dataDir := t.TempDir()
	ingestDir := t.TempDir()
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	r := chi.NewRouter()
	uploads.NewHandler(uploads.NewRepository(database), library.NewQueue(database), mw, dataDir, ingestDir).
		Routes(r)
	return &uploadServer{db: database, store: store, router: r, dataDir: dataDir, ingestDir: ingestDir}
}

// do issues one request with an optional body and session cookie.
func (s *uploadServer) do(t *testing.T, method, path string, body []byte, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

// doJSON issues a JSON-bodied request (create/complete endpoints).
func (s *uploadServer) doJSON(t *testing.T, method, path string, payload any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

func (s *uploadServer) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
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

// addLibrary registers a libraries row with a real UUID id (the create route
// validates the uuid shape before checking existence).
func addLibrary(t *testing.T, database *sql.DB) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := database.Exec(
		`INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		id, "music", t.TempDir()); err != nil {
		t.Fatalf("insert library: %v", err)
	}
	return id
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatalf("decode response (%d): %v", rec.Code, err)
	}
	return out
}

// createSession runs the create route and returns the minted session id.
func (s *uploadServer) createSession(t *testing.T, admin *http.Cookie, libraryID, strategy string) string {
	t.Helper()
	payload := map[string]string{"libraryId": libraryID}
	if strategy != "" {
		payload["duplicateStrategy"] = strategy
	}
	rec := s.doJSON(t, http.MethodPost, "/api/upload/sessions", payload, admin)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create session: want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	id, ok := decodeBody(t, rec)["sessionId"].(string)
	if !ok || id == "" {
		t.Fatalf("create session: no sessionId in %s", rec.Body.String())
	}
	return id
}

func countRows(t *testing.T, database *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := database.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count rows: %v\n%s", err, query)
	}
	return n
}

// splitOdd cuts data into n parts at deliberately odd offsets.
func splitOdd(data []byte, n int) [][]byte {
	parts := make([][]byte, 0, n)
	start := 0
	for i := 0; i < n; i++ {
		remaining := len(data) - start
		left := n - i
		size := remaining / left
		if i < remaining%left {
			size++
		}
		// Odd offsets where possible so boundaries land mid-frame —
		// never on the final part, which must take the remainder.
		if i < n-1 && size > 1 && size%2 == 0 {
			size--
		}
		parts = append(parts, data[start:start+size])
		start += size
	}
	return parts
}

// TestProtocolRoundTrip: create → 3 odd-offset chunks of a real audio file →
// file complete → session complete. The file must land under
// <ingest>/<libraryId>/ byte-identical, exactly one typed ingest job must be
// queued with the right payload, and the session row + dir must be gone.
func TestProtocolRoundTrip(t *testing.T) {
	s := newUploadServer(t)
	admin := s.session(t, "user-admin", "root", true)
	libraryID := addLibrary(t, s.db)

	original, err := os.ReadFile(filepath.Join(corpusDir, "spike.mp3"))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	parts := splitOdd(original, 3)
	if len(parts[0])%2 != 1 || len(parts[1])%2 != 1 {
		t.Fatalf("splitOdd must produce odd offsets: %d, %d", len(parts[0]), len(parts[1]))
	}

	sessionID := s.createSession(t, admin, libraryID, "skip")
	fileID := "track-01"
	for i, part := range parts {
		rec := s.do(t, http.MethodPut,
			fmt.Sprintf("/api/upload/sessions/%s/files/%s/chunks/%d", sessionID, fileID, i),
			part, admin)
		if rec.Code != http.StatusOK {
			t.Fatalf("chunk %d: want 200, got %d: %s", i, rec.Code, rec.Body.String())
		}
	}

	rec := s.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/upload/sessions/%s/files/%s/complete", sessionID, fileID),
		map[string]any{"totalChunks": len(parts), "relativePath": "incoming/spike.mp3"}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("complete file: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["fileName"] != "incoming/spike.mp3" {
		t.Fatalf("fileName: %v", body)
	}
	if body["size"] != float64(len(original)) {
		t.Fatalf("size: want %d, got %v", len(original), body["size"])
	}

	rec = s.do(t, http.MethodPost, fmt.Sprintf("/api/upload/sessions/%s/complete", sessionID), nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("complete session: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if decodeBody(t, rec)["ok"] != true {
		t.Fatalf("complete session body: %s", rec.Body.String())
	}

	landed, err := os.ReadFile(filepath.Join(s.ingestDir, libraryID, "incoming", "spike.mp3"))
	if err != nil {
		t.Fatalf("file must land in ingest: %v", err)
	}
	if !bytes.Equal(landed, original) {
		t.Fatalf("ingested file differs from the uploaded bytes (%d vs %d bytes)", len(landed), len(original))
	}

	// Exactly one typed ingest job with the correct payload.
	if got := countRows(t, s.db, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'ingest'`); got != 1 {
		t.Fatalf("want exactly 1 ingest job, got %d", got)
	}
	var rawPayload string
	if err := s.db.QueryRow(`SELECT payload FROM scan_jobs WHERE type = 'ingest'`).Scan(&rawPayload); err != nil {
		t.Fatalf("load job payload: %v", err)
	}
	var payload library.IngestPayload
	if err := json.Unmarshal([]byte(rawPayload), &payload); err != nil {
		t.Fatalf("decode typed payload: %v", err)
	}
	wantPath := filepath.Join(s.ingestDir, libraryID)
	if payload.SourcePath != wantPath || payload.LibraryID != libraryID || payload.DuplicateStrategy != "skip" {
		t.Fatalf("payload mismatch: %+v (want sourcePath=%s libraryId=%s strategy=skip)", payload, wantPath, libraryID)
	}

	// Session row and directory are gone.
	if got := countRows(t, s.db, `SELECT COUNT(1) FROM upload_sessions WHERE id = ?`, sessionID); got != 0 {
		t.Fatalf("session row must be deleted")
	}
	if _, err := os.Stat(filepath.Join(s.dataDir, "uploads", sessionID)); !os.IsNotExist(err) {
		t.Fatalf("session dir must be removed: %v", err)
	}
}

func TestCreateSessionValidation(t *testing.T) {
	s := newUploadServer(t)
	admin := s.session(t, "user-admin", "root", true)
	libraryID := addLibrary(t, s.db)

	rec := s.doJSON(t, http.MethodPost, "/api/upload/sessions", map[string]string{"libraryId": "not-a-uuid"}, admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("non-uuid libraryId: want 400, got %d", rec.Code)
	}
	rec = s.doJSON(t, http.MethodPost, "/api/upload/sessions", map[string]string{"libraryId": uuid.NewString()}, admin)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown library: want 404, got %d", rec.Code)
	}
	rec = s.doJSON(t, http.MethodPost, "/api/upload/sessions",
		map[string]string{"libraryId": libraryID, "duplicateStrategy": "nuke_it"}, admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad strategy: want 400, got %d", rec.Code)
	}

	// Valid, no strategy: response omits the key (v1 shape).
	rec = s.doJSON(t, http.MethodPost, "/api/upload/sessions", map[string]string{"libraryId": libraryID}, admin)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: want 201, got %d", rec.Code)
	}
	body := decodeBody(t, rec)
	if _, present := body["duplicateStrategy"]; present {
		t.Fatalf("unset strategy must be omitted: %v", body)
	}

	// Valid strategy round-trips.
	rec = s.doJSON(t, http.MethodPost, "/api/upload/sessions",
		map[string]string{"libraryId": libraryID, "duplicateStrategy": "keep_file_replace_metadata"}, admin)
	body = decodeBody(t, rec)
	if body["duplicateStrategy"] != "keep_file_replace_metadata" {
		t.Fatalf("strategy echo: %v", body)
	}
}

// TestValidationMatrix exercises every 4xx guard on the chunk/complete
// routes, including the audit's B11 lesson: a missing chunk is a typed 4xx
// naming the index, never a 500.
func TestValidationMatrix(t *testing.T) {
	s := newUploadServer(t)
	admin := s.session(t, "user-admin", "root", true)
	libraryID := addLibrary(t, s.db)
	sessionID := s.createSession(t, admin, libraryID, "")
	base := fmt.Sprintf("/api/upload/sessions/%s", sessionID)

	put := func(path string, body []byte) *httptest.ResponseRecorder {
		return s.do(t, http.MethodPut, path, body, admin)
	}

	if rec := put(base+"/files/bad..id/chunks/0", []byte("x")); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad fileId: want 400, got %d", rec.Code)
	}
	if rec := put(base+"/files/f1/chunks/12a", []byte("x")); rec.Code != http.StatusBadRequest {
		t.Fatalf("non-digit index: want 400, got %d", rec.Code)
	}
	if rec := put(base+"/files/f1/chunks/10000", []byte("x")); rec.Code != http.StatusBadRequest {
		t.Fatalf("index >= 10000: want 400, got %d", rec.Code)
	}

	// Unknown session: 404 and, per the v1 rule, no disk write at all.
	unknownID := uuid.NewString()
	rec := put(fmt.Sprintf("/api/upload/sessions/%s/files/f1/chunks/0", unknownID), []byte("x"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown session: want 404, got %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(s.dataDir, "uploads", unknownID)); !os.IsNotExist(err) {
		t.Fatalf("unknown session must not create a directory: %v", err)
	}

	// Chunk over the 10 MiB cap (declared Content-Length): early 413.
	big := make([]byte, uploads.MaxChunkBytes+1)
	if rec := put(base+"/files/f1/chunks/0", big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized chunk: want 413, got %d", rec.Code)
	}

	// Two real chunks, then complete claiming four: typed 4xx naming the
	// first missing index.
	if rec := put(base+"/files/f1/chunks/0", []byte("aa")); rec.Code != http.StatusOK {
		t.Fatalf("chunk 0: %d", rec.Code)
	}
	if rec := put(base+"/files/f1/chunks/1", []byte("bb")); rec.Code != http.StatusOK {
		t.Fatalf("chunk 1: %d", rec.Code)
	}
	rec = s.doJSON(t, http.MethodPost, base+"/files/f1/complete",
		map[string]any{"totalChunks": 4, "relativePath": "f.bin"}, admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("wrong totalChunks: want 400, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "missing chunk 2") {
		t.Fatalf("error must name the missing index: %s", rec.Body.String())
	}

	// Traversal attempts on the final path, on both separators.
	for _, evil := range []string{"../x.mp3", "/etc/owned.mp3", `a\..\x.mp3`, ".."} {
		rec = s.doJSON(t, http.MethodPost, base+"/files/f1/complete",
			map[string]any{"totalChunks": 2, "relativePath": evil}, admin)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("relativePath %q: want 400, got %d", evil, rec.Code)
		}
	}

	// File cap, enforced incrementally during reassembly: lower the cap and
	// watch complete reject the stream after the second chunk.
	oldCap := uploads.MaxFileBytes
	uploads.MaxFileBytes = 3
	t.Cleanup(func() { uploads.MaxFileBytes = oldCap })
	rec = s.doJSON(t, http.MethodPost, base+"/files/f1/complete",
		map[string]any{"totalChunks": 2, "relativePath": "f.bin"}, admin)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("over cap: want 413, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(s.dataDir, "uploads", sessionID, "files", "f.bin")); !os.IsNotExist(err) {
		t.Fatalf("rejected reassembly must not leave a partial file: %v", err)
	}
}

// TestReassemblyMemoryBounded streams ~30 MiB through complete-file and
// asserts the total allocation delta stays far below v1's behavior, which
// buffered the whole file in the heap (Buffer.concat). Loose enough for CI
// noise, tight enough to catch a regression to buffering.
func TestReassemblyMemoryBounded(t *testing.T) {
	s := newUploadServer(t)
	admin := s.session(t, "user-admin", "root", true)
	libraryID := addLibrary(t, s.db)
	sessionID := s.createSession(t, admin, libraryID, "")

	const chunkSize = 5 << 20
	const chunks = 6 // 30 MiB total
	block := bytes.Repeat([]byte{0x5a}, 1<<20)
	for i := 0; i < chunks; i++ {
		var buf bytes.Buffer
		for buf.Len() < chunkSize {
			buf.Write(block)
		}
		rec := s.do(t, http.MethodPut,
			fmt.Sprintf("/api/upload/sessions/%s/files/big/chunks/%d", sessionID, i), buf.Bytes(), admin)
		if rec.Code != http.StatusOK {
			t.Fatalf("chunk %d: %d", i, rec.Code)
		}
	}

	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	rec := s.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/upload/sessions/%s/files/big/complete", sessionID),
		map[string]any{"totalChunks": chunks, "relativePath": "big.bin"}, admin)
	runtime.GC()
	runtime.ReadMemStats(&after)
	if rec.Code != http.StatusOK {
		t.Fatalf("complete: %d: %s", rec.Code, rec.Body.String())
	}
	if body := decodeBody(t, rec); body["size"] != float64(chunkSize*chunks) {
		t.Fatalf("size: %v", body)
	}

	const limit = 64 << 20
	if delta := after.TotalAlloc - before.TotalAlloc; delta >= limit {
		t.Fatalf("reassembly allocated %d MiB (limit %d MiB) — buffering crept back in", delta>>20, limit>>20)
	}
}

func TestRePutOverwrite(t *testing.T) {
	s := newUploadServer(t)
	admin := s.session(t, "user-admin", "root", true)
	libraryID := addLibrary(t, s.db)
	sessionID := s.createSession(t, admin, libraryID, "")
	base := fmt.Sprintf("/api/upload/sessions/%s/files/f1", sessionID)

	put := func(index int, body string) {
		t.Helper()
		if rec := s.do(t, http.MethodPut, fmt.Sprintf("%s/chunks/%d", base, index), []byte(body), admin); rec.Code != http.StatusOK {
			t.Fatalf("chunk %d: %d", index, rec.Code)
		}
	}
	put(0, "AAAAAAAA")
	put(1, "BBBB")
	// Retry of chunk 0 with different content: overwrite wins.
	put(0, "CC")

	rec := s.doJSON(t, http.MethodPost, base+"/complete",
		map[string]any{"totalChunks": 2, "relativePath": "x.bin"}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("complete: %d", rec.Code)
	}
	got, err := os.ReadFile(filepath.Join(s.dataDir, "uploads", sessionID, "files", "x.bin"))
	if err != nil {
		t.Fatalf("read reassembled: %v", err)
	}
	if string(got) != "CCBBBB" {
		t.Fatalf("overwrite: got %q", got)
	}
}

// TestIdempotentComplete: a double session-complete is a clean 404 (the row
// is gone), with no duplicate moves and no duplicate ingest job.
func TestIdempotentComplete(t *testing.T) {
	s := newUploadServer(t)
	admin := s.session(t, "user-admin", "root", true)
	libraryID := addLibrary(t, s.db)
	sessionID := s.createSession(t, admin, libraryID, "")
	base := fmt.Sprintf("/api/upload/sessions/%s", sessionID)

	if rec := s.do(t, http.MethodPut, base+"/files/f1/chunks/0", []byte("payload"), admin); rec.Code != http.StatusOK {
		t.Fatalf("chunk: %d", rec.Code)
	}
	rec := s.doJSON(t, http.MethodPost, base+"/files/f1/complete",
		map[string]any{"totalChunks": 1, "relativePath": "only.mp3"}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("complete file: %d", rec.Code)
	}

	if rec := s.do(t, http.MethodPost, base+"/complete", nil, admin); rec.Code != http.StatusOK {
		t.Fatalf("complete session: %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPost, base+"/complete", nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("second complete: want 404, got %d", rec.Code)
	}

	if got := countRows(t, s.db, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'ingest'`); got != 1 {
		t.Fatalf("double complete must not enqueue twice: %d jobs", got)
	}
	entries, err := os.ReadDir(filepath.Join(s.ingestDir, libraryID))
	if err != nil || len(entries) != 1 {
		t.Fatalf("double complete must not move twice: entries=%v err=%v", entries, err)
	}
}

func TestGetSessionStatus(t *testing.T) {
	s := newUploadServer(t)
	admin := s.session(t, "user-admin", "root", true)
	libraryID := addLibrary(t, s.db)
	sessionID := s.createSession(t, admin, libraryID, "")
	base := fmt.Sprintf("/api/upload/sessions/%s", sessionID)

	// Fresh session: empty status, not an error.
	rec := s.do(t, http.MethodGet, base, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("get fresh: %d", rec.Code)
	}
	body := decodeBody(t, rec)
	if body["sessionId"] != sessionID || body["libraryId"] != libraryID {
		t.Fatalf("status identity: %v", body)
	}

	// Two chunks for one file, one chunk + complete for another.
	for i, c := range []string{"aaa", "bb"} {
		if rec := s.do(t, http.MethodPut, fmt.Sprintf("%s/files/a/chunks/%d", base, i), []byte(c), admin); rec.Code != http.StatusOK {
			t.Fatalf("chunk: %d", rec.Code)
		}
	}
	if rec := s.do(t, http.MethodPut, base+"/files/b/chunks/0", []byte("xyz"), admin); rec.Code != http.StatusOK {
		t.Fatalf("chunk b: %d", rec.Code)
	}
	rec = s.doJSON(t, http.MethodPost, base+"/files/b/complete",
		map[string]any{"totalChunks": 1, "relativePath": "dir/t.mp3"}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("complete b: %d", rec.Code)
	}

	rec = s.do(t, http.MethodGet, base, nil, admin)
	body = decodeBody(t, rec)
	files, ok := body["files"].([]any)
	if !ok || len(files) != 2 {
		t.Fatalf("status files: %v", body["files"])
	}
	byID := map[string]map[string]any{}
	for _, f := range files {
		m := f.(map[string]any)
		byID[m["fileId"].(string)] = m
	}
	if byID["a"]["chunksReceived"] != float64(2) || byID["a"]["chunkBytes"] != float64(5) {
		t.Fatalf("file a status: %v", byID["a"])
	}
	if byID["b"]["chunksReceived"] != float64(1) {
		t.Fatalf("file b status: %v", byID["b"])
	}
	reassembled, ok := body["reassembled"].([]any)
	if !ok || len(reassembled) != 1 {
		t.Fatalf("status reassembled: %v", body["reassembled"])
	}
	entry := reassembled[0].(map[string]any)
	if entry["path"] != "dir/t.mp3" || entry["size"] != float64(3) {
		t.Fatalf("reassembled entry: %v", entry)
	}
}

// TestAuthz: every route 401s anonymous callers and 403s authenticated
// non-admins (matching v1's requireAdmin), with no side effects.
func TestAuthz(t *testing.T) {
	s := newUploadServer(t)
	admin := s.session(t, "user-admin", "root", true)
	alice := s.session(t, "user-alice", "alice", false)
	libraryID := addLibrary(t, s.db)
	sessionID := s.createSession(t, admin, libraryID, "")

	routes := []struct {
		method, path string
		body         []byte
		json         bool
	}{
		{http.MethodPost, "/api/upload/sessions", []byte(`{"libraryId":"` + libraryID + `"}`), true},
		{http.MethodGet, "/api/upload/sessions/" + sessionID, nil, false},
		{http.MethodPut, fmt.Sprintf("/api/upload/sessions/%s/files/f/chunks/0", sessionID), []byte("x"), false},
		{http.MethodPost, fmt.Sprintf("/api/upload/sessions/%s/files/f/complete", sessionID), []byte(`{"totalChunks":1,"relativePath":"x"}`), true},
		{http.MethodPost, fmt.Sprintf("/api/upload/sessions/%s/complete", sessionID), nil, false},
	}
	issue := func(rt struct {
		method, path string
		body         []byte
		json         bool
	}, cookie *http.Cookie) *httptest.ResponseRecorder {
		if rt.json {
			req := httptest.NewRequest(rt.method, rt.path, bytes.NewReader(rt.body))
			req.Header.Set("Content-Type", "application/json")
			if cookie != nil {
				req.AddCookie(cookie)
			}
			rec := httptest.NewRecorder()
			s.router.ServeHTTP(rec, req)
			return rec
		}
		return s.do(t, rt.method, rt.path, rt.body, cookie)
	}

	for _, rt := range routes {
		if rec := issue(rt, nil); rec.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s %s: want 401, got %d", rt.method, rt.path, rec.Code)
		}
		if rec := issue(rt, alice); rec.Code != http.StatusForbidden {
			t.Fatalf("non-admin %s %s: want 403, got %d", rt.method, rt.path, rec.Code)
		}
	}
	if got := countRows(t, s.db, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'ingest'`); got != 0 {
		t.Fatalf("forbidden calls must not enqueue: %d", got)
	}
	// Session creation is DB-only (the seeded session made no directory),
	// so nothing at all may exist under uploads/.
	if entries, _ := os.ReadDir(filepath.Join(s.dataDir, "uploads")); len(entries) != 0 {
		t.Fatalf("forbidden calls must not touch disk: %d entries", len(entries))
	}
}
