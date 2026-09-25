// Artist image sync tests: an httptest fake serves both the Deezer search
// API and the image binaries; the syncer is pointed at it with the
// politeness delay disabled. Covers the happy path, non-image content
// rejection, per-artist error isolation, the refetch-existing filter, the
// write-new-then-remove-old ordering, and the HTTP routes.
package artistimages_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/artistimages"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
)

const testSecret = "0123456789abcdef0123456789abcdef"

// tinyJPEG is a magic-valid JPEG header (the sniffer only checks the first
// three bytes).
var tinyJPEG = []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 'x', 'x'}

// tinyPNG is a magic-valid PNG.
var tinyPNG = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 'x'}

type env struct {
	db      *sql.DB
	store   *auth.Store
	syncer  *artistimages.Syncer
	handler *artistimages.Handler
	queue   *library.Queue
	dataDir string
	router  http.Handler
}

func newEnv(t *testing.T, fake *httptest.Server) *env {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	dataDir := t.TempDir()
	syncer := artistimages.NewSyncer(database, dataDir, discardLogger(),
		artistimages.WithDeezerBaseURL(fake.URL+"/deezer"),
		artistimages.WithPolitenessDelay(0),
		artistimages.WithHTTPClient(fake.Client()),
	)
	queue := library.NewQueue(database)
	handler := artistimages.NewHandler(syncer, queue)
	mw := auth.NewMiddleware(auth.NewStore(database), database, testSecret, false)
	r := chi.NewRouter()
	handler.Routes(r, mw)
	return &env{db: database, store: auth.NewStore(database), syncer: syncer,
		handler: handler, queue: queue, dataDir: dataDir, router: r}
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// deezerFake serves the search API (one hit per artist name) and the image
// binaries under /img/<format>.
func deezerFake(t *testing.T, names map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/deezer/search/artist":
			q := r.URL.Query().Get("q")
			format, ok := names[q]
			if !ok {
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, `{"data": []}`)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"data": [{"id": 7, "name": %q, "picture_xl": "http://%s/img/%s"}]}`, q, r.Host, format)
		case len(r.URL.Path) > 5 && r.URL.Path[:5] == "/img/":
			w.Header().Set("Content-Type", map[string]string{
				"jpg":  "image/jpeg",
				"png":  "image/png",
				"html": "text/html",
			}[filepath.Base(r.URL.Path)])
			switch filepath.Base(r.URL.Path) {
			case "jpg":
				w.Write(tinyJPEG)
			case "png":
				w.Write(tinyPNG)
			default:
				fmt.Fprint(w, "<html>not an image</html>")
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func (e *env) addArtist(t *testing.T, id, name string) {
	t.Helper()
	if _, err := e.db.Exec(`INSERT INTO artists (id, name, active) VALUES (?, ?, 1)`, id, name); err != nil {
		t.Fatalf("insert artist: %v", err)
	}
}

func (e *env) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
	t.Helper()
	if _, err := e.db.Exec(
		`INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, 'x', ?)
		 ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin`,
		userID, username, boolToInt(isAdmin)); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	sid := auth.NewSID()
	if err := e.store.Create(context.Background(), sid, auth.Session{
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

func (e *env) do(t *testing.T, method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func TestSyncDownloadsAndRecordsImages(t *testing.T) {
	fake := deezerFake(t, map[string]string{"Has Image": "jpg", "Second Artist": "png"})
	defer fake.Close()
	e := newEnv(t, fake)
	e.addArtist(t, "ar-1", "Has Image")
	e.addArtist(t, "ar-2", "Second Artist")

	stats, err := e.syncer.Sync(context.Background(), false)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if stats.Scanned != 2 || stats.Updated != 2 || stats.Failed != 0 {
		t.Fatalf("stats = %+v", stats)
	}

	// The file lands at DATA_DIR/artist-images/<id>.<ext>.
	data, err := os.ReadFile(filepath.Join(e.dataDir, "artist-images", "ar-1.jpg"))
	if err != nil {
		t.Fatalf("read ar-1 image: %v", err)
	}
	if len(data) != len(tinyJPEG) {
		t.Fatalf("image bytes = %d", len(data))
	}
	var localPath, imageURL string
	if err := e.db.QueryRow(`SELECT artist_image_local_path, artist_image_url FROM artists WHERE id = 'ar-1'`).
		Scan(&localPath, &imageURL); err != nil {
		t.Fatal(err)
	}
	if localPath != filepath.Join(e.dataDir, "artist-images", "ar-1.jpg") {
		t.Fatalf("local path = %q", localPath)
	}
	if imageURL == "" {
		t.Fatal("image url not recorded")
	}

	// A second sync (no refetch) skips artists that already have a file.
	stats, err = e.syncer.Sync(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Scanned != 0 || stats.Updated != 0 {
		t.Fatalf("second sync stats = %+v", stats)
	}

	// Refetch re-downloads everything.
	stats, err = e.syncer.Sync(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Scanned != 2 || stats.Updated != 2 {
		t.Fatalf("refetch stats = %+v", stats)
	}
}

func TestSyncSkipsNonImageContentAndMissingArtists(t *testing.T) {
	// "No Hit Anywhere" is NOT in the fake's map → the search answers an
	// empty result set; "Bad Image" resolves but serves HTML.
	fake := deezerFake(t, map[string]string{"Bad Image": "html"})
	defer fake.Close()
	e := newEnv(t, fake)
	e.addArtist(t, "ar-bad", "Bad Image")
	e.addArtist(t, "ar-nohit", "No Hit Anywhere")

	stats, err := e.syncer.Sync(context.Background(), false)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	// No-hit is neither updated nor a failure (v1 continue); the HTML
	// content is a failure but does not abort the run.
	if stats.Scanned != 2 || stats.Failed != 1 || stats.Updated != 0 {
		t.Fatalf("stats = %+v", stats)
	}
	var localPath *string
	if err := e.db.QueryRow(`SELECT artist_image_local_path FROM artists WHERE id = 'ar-nohit'`).Scan(&localPath); err != nil {
		t.Fatal(err)
	}
	if localPath != nil && *localPath != "" {
		t.Fatalf("no-hit artist got a path: %v", *localPath)
	}
}

func TestSyncReplacesOldExtension(t *testing.T) {
	// The fake serves jpeg first, png second: the second sync must write the
	// new extension and REMOVE the old file (write-new-then-remove-old).
	var calls int32
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/deezer/search/artist" {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"data": [{"id": 7, "name": "Switcher", "picture_xl": "http://%s/img/x"}]}`, r.Host)
			return
		}
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			w.Header().Set("Content-Type", "image/jpeg")
			w.Write(tinyJPEG)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write(tinyPNG)
	}))
	defer fake.Close()

	e := newEnv(t, fake)
	e.addArtist(t, "ar-sw", "Switcher")
	if _, err := e.syncer.Sync(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	oldPath := filepath.Join(e.dataDir, "artist-images", "ar-sw.jpg")
	if _, err := os.Stat(oldPath); err != nil {
		t.Fatalf("first sync should write .jpg: %v", err)
	}

	if _, err := e.syncer.Sync(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatal("old .jpg file was not removed after the format change")
	}
	var localPath string
	if err := e.db.QueryRow(`SELECT artist_image_local_path FROM artists WHERE id = 'ar-sw'`).Scan(&localPath); err != nil {
		t.Fatal(err)
	}
	if filepath.Ext(localPath) != ".png" {
		t.Fatalf("recorded path = %q, want .png", localPath)
	}
}

func TestGetArtistImageRoute(t *testing.T) {
	fake := deezerFake(t, map[string]string{"Routed": "jpg"})
	defer fake.Close()
	e := newEnv(t, fake)
	e.addArtist(t, "ar-routed", "Routed")

	// No image yet → 404.
	rec := e.do(t, http.MethodGet, "/api/artist-images/ar-routed", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("before sync: want 404, got %d", rec.Code)
	}

	if _, err := e.syncer.Sync(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	rec = e.do(t, http.MethodGet, "/api/artist-images/ar-routed", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("after sync: want 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("content type = %q", ct)
	}
	if rec.Body.Len() != len(tinyJPEG) {
		t.Fatalf("body = %d bytes", rec.Body.Len())
	}

	// Unknown artist → 404.
	if rec := e.do(t, http.MethodGet, "/api/artist-images/nope", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown: want 404, got %d", rec.Code)
	}
}

func TestRefetchRouteEnqueuesJob(t *testing.T) {
	fake := deezerFake(t, nil)
	defer fake.Close()
	e := newEnv(t, fake)

	if rec := e.do(t, http.MethodPost, "/api/admin/artists/refetch", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous refetch: want 401, got %d", rec.Code)
	}
	user := e.session(t, "u-1", "user", false)
	if rec := e.do(t, http.MethodPost, "/api/admin/artists/refetch", user); rec.Code != http.StatusForbidden {
		t.Fatalf("user refetch: want 403, got %d", rec.Code)
	}

	admin := e.session(t, "u-admin", "admin", true)
	rec := e.do(t, http.MethodPost, "/api/admin/artists/refetch", admin)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("refetch: want 202, got %d", rec.Code)
	}
	var out map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	jobID, _ := out["jobId"].(string)
	if jobID == "" || out["ok"] != true {
		t.Fatalf("response = %v", out)
	}
	job, err := e.queue.JobByID(context.Background(), jobID)
	if err != nil || job == nil {
		t.Fatalf("job %s: %v", jobID, err)
	}
	if job.Type != library.JobTypeArtistImages {
		t.Fatalf("job type = %s", job.Type)
	}
	var payload library.ArtistImagesPayload
	if err := job.DecodePayload(&payload); err != nil {
		t.Fatal(err)
	}
	if !payload.RefetchExisting {
		t.Fatal("refetch payload must set RefetchExisting")
	}
}

// TestRunJobExecutesThroughWorkerContract drives the registered handler the
// way the library worker does.
func TestRunJobExecutesThroughWorkerContract(t *testing.T) {
	fake := deezerFake(t, map[string]string{"Job Artist": "jpg"})
	defer fake.Close()
	e := newEnv(t, fake)
	e.addArtist(t, "ar-job", "Job Artist")

	jobID, err := e.queue.Push(context.Background(), library.JobTypeArtistImages,
		library.ArtistImagesPayload{RefetchExisting: false})
	if err != nil {
		t.Fatal(err)
	}
	job, err := e.queue.JobByID(context.Background(), jobID)
	if err != nil {
		t.Fatal(err)
	}
	statsRaw, err := e.syncer.RunJob(context.Background(), job)
	if err != nil {
		t.Fatalf("RunJob: %v", err)
	}
	stats, ok := statsRaw.(*artistimages.SyncStats)
	if !ok {
		t.Fatalf("stats type = %T", statsRaw)
	}
	if stats.Updated != 1 {
		t.Fatalf("stats = %+v", stats)
	}
}
