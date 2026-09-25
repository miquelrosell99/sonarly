// Tag-edit and cover-art route tests. The writer is faked for the route
// matrices (file mutation is the audio writer's own test); one end-to-end
// test runs the real mutagen writer against a corpus copy, guarded like
// v1's suite.
package tags_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/v2/internal/audio"
	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/tags"
)

const testSecret = "0123456789abcdef0123456789abcdef"

// fakeWriter records writes without touching the file — the route flow
// (organize, persist, resync) is what these tests exercise.
type fakeWriter struct {
	calls []writeCall
	err   error
}

type writeCall struct {
	path string
	tags audio.SongTags
}

func (f *fakeWriter) Supports(string) bool { return true }
func (f *fakeWriter) Write(_ context.Context, path string, tags audio.SongTags) error {
	f.calls = append(f.calls, writeCall{path, tags})
	return f.err
}

type server struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
	writer *fakeWriter
	svc    *tags.Service
	libDir string
}

func newServer(t *testing.T) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	libDir := t.TempDir()
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	queue := library.NewQueue(database)
	ingestSvc := ingest.NewService(database, discardLogger(), queue, ingest.Options{
		LibraryPath:         libDir,
		ReviewRetentionDays: 30,
	})
	writer := &fakeWriter{}
	svc := tags.NewService(database, writer, ingestSvc, queue)
	r := chi.NewRouter()
	tags.NewHandler(svc, mw).Routes(r)
	s := &server{db: database, store: store, router: r, writer: writer, svc: svc, libDir: libDir}
	s.addLibrary(t)
	return s
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func (s *server) addLibrary(t *testing.T) {
	t.Helper()
	if _, err := s.db.Exec(
		`INSERT INTO libraries (id, name, path, organize_pattern, is_default, created_at, updated_at)
		 VALUES ('lib-1', 'Main', ?, '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}', 1, datetime('now'), datetime('now'))`,
		s.libDir); err != nil {
		t.Fatalf("insert library: %v", err)
	}
}

// seedSong copies a corpus file into the library and persists it through the
// one data path, returning the song id.
func (s *server) seedSong(t *testing.T, corpus, name string) (songID, path string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "audio", "testdata", "corpus", corpus))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	path = filepath.Join(s.libDir, name)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write song: %v", err)
	}
	meta, err := audio.ReadMetadata(path)
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	checksum, err := library.ChecksumFile(path)
	if err != nil {
		t.Fatal(err)
	}
	libraryID := "lib-1"
	id, err := library.PersistSong(context.Background(), s.db, library.PersistInput{
		Path: path, Meta: meta, Mtime: info.ModTime().UnixMilli(), Checksum: checksum, LibraryID: &libraryID,
	})
	if err != nil {
		t.Fatalf("persist song: %v", err)
	}
	return id, path
}

func (s *server) do(t *testing.T, method, path string, body any, raw []byte, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	switch {
	case raw != nil:
		reader = bytes.NewReader(raw)
	case body != nil:
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(encoded)
	default:
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	if raw != nil {
		req.Header.Set("Content-Type", "image/png")
	} else {
		req.Header.Set("Content-Type", "application/json")
	}
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

func TestPutSongTagsValidation(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)

	cases := []struct {
		name string
		body map[string]any
		want string
	}{
		{"unknown field", map[string]any{"mood": "dark"}, "Unknown tag field: mood"},
		{"title type", map[string]any{"title": 42}, "title must be a string"},
		{"album type", map[string]any{"album": true}, "album must be a string"},
		{"artist element type", map[string]any{"artist": []any{"ok", 7}}, "artist must be a string or an array of strings"},
		{"trackNumber type", map[string]any{"trackNumber": "3"}, "trackNumber must be an integer"},
		{"year type", map[string]any{"year": 3.5}, "year must be an integer"},
		{"explicit type", map[string]any{"explicit": "yes"}, "explicit must be a boolean"},
		{"lyrics type", map[string]any{"lyrics": []any{}}, "lyrics must be a string"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := s.do(t, http.MethodPut, "/api/songs/whatever/tags", tc.body, nil, admin)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d", rec.Code)
			}
			if got := decode(t, rec)["error"]; got != tc.want {
				t.Fatalf("error = %v, want %q", got, tc.want)
			}
		})
	}
}

func TestPutSongTagsAuthz(t *testing.T) {
	s := newServer(t)
	songID, _ := s.seedSong(t, "spike.mp3", "plain.mp3")

	if rec := s.do(t, http.MethodPut, "/api/songs/"+songID+"/tags", map[string]any{"title": "x"}, nil, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: want 401, got %d", rec.Code)
	}
	user := s.session(t, "u-user", "user", false)
	rec := s.do(t, http.MethodPut, "/api/songs/"+songID+"/tags", map[string]any{"title": "x"}, nil, user)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin: want 403, got %d", rec.Code)
	}
	admin := s.session(t, "u-admin", "admin", true)
	if rec := s.do(t, http.MethodPut, "/api/songs/nope/tags", map[string]any{"title": "x"}, nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown song: want 404, got %d", rec.Code)
	}
}

func TestPutSongTagsFlow(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	songID, path := s.seedSong(t, "spike.mp3", "flat.mp3")

	rec := s.do(t, http.MethodPut, "/api/songs/"+songID+"/tags",
		map[string]any{"title": "New Title", "artist": []any{"  Someone Else  ", ""}, "trackNumber": 3}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if out := decode(t, rec); out["ok"] != true {
		t.Fatalf("response: %v", out)
	}

	// The writer saw the normalized tags and the original path.
	if len(s.writer.calls) != 1 {
		t.Fatalf("writer calls = %d, want 1", len(s.writer.calls))
	}
	call := s.writer.calls[0]
	if call.path != path {
		t.Fatalf("writer path = %s, want %s", call.path, path)
	}
	if call.tags.Title == nil || *call.tags.Title != "New Title" {
		t.Fatalf("title = %v", call.tags.Title)
	}
	if len(call.tags.Artist) != 1 || call.tags.Artist[0] != "Someone Else" {
		t.Fatalf("artist = %v", call.tags.Artist)
	}
	if call.tags.TrackNumber == nil || *call.tags.TrackNumber != 3 {
		t.Fatalf("trackNumber = %v", call.tags.TrackNumber)
	}

	// The organize step moved the file (spike.mp3's own tags define a
	// pattern target different from the flat path it was seeded at).
	var newPath string
	if err := s.db.QueryRow(`SELECT file_path FROM songs WHERE id = ?`, songID).Scan(&newPath); err != nil {
		t.Fatal(err)
	}
	if newPath == path {
		t.Fatal("file was not reorganized after the tag write")
	}
	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("moved file missing: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("original path still occupied after the move")
	}

	// A resync job is queued.
	var resyncCount int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM scan_jobs WHERE type = 'resync'`).Scan(&resyncCount); err != nil {
		t.Fatal(err)
	}
	if resyncCount != 1 {
		t.Fatalf("resync jobs = %d, want 1", resyncCount)
	}
}

func TestPutSongTagsOrphanedEntities(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	songID, _ := s.seedSong(t, "spike.mp3", "orphan.mp3")

	// The seeded song is the only song of its (corpus) artist; renaming the
	// artist away orphans it.
	var artistID, artistName string
	if err := s.db.QueryRow(`SELECT artist_id FROM songs WHERE id = ?`, songID).Scan(&artistID); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT name FROM artists WHERE id = ?`, artistID).Scan(&artistName); err != nil {
		t.Fatal(err)
	}
	rec := s.do(t, http.MethodPut, "/api/songs/"+songID+"/tags",
		map[string]any{"artist": "Completely Different"}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	orphaned, ok := decode(t, rec)["orphanedEntities"].([]any)
	if !ok || len(orphaned) != 1 {
		t.Fatalf("orphanedEntities = %v", decode(t, rec))
	}
	entry := orphaned[0].(map[string]any)
	if entry["type"] != "artist" || entry["id"] != artistID || entry["name"] != artistName {
		t.Fatalf("orphan entry = %v", entry)
	}
}

func TestPutSongsTagsMultiStopsAtFirstFailure(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	first, _ := s.seedSong(t, "spike.mp3", "one.mp3")
	second, _ := s.seedSong(t, "spike.ogg", "two.ogg")

	rec := s.do(t, http.MethodPut, "/api/songs/tags",
		map[string]any{"ids": []any{first, "nope", second}, "tags": map[string]any{"title": "T"}}, nil, admin)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
	out := decode(t, rec)
	if out["failedId"] != "nope" {
		t.Fatalf("failedId = %v", out)
	}
	if len(s.writer.calls) != 1 {
		t.Fatalf("writer calls = %d, want 1 (stop at first failure)", len(s.writer.calls))
	}

	// ids must be strings.
	rec = s.do(t, http.MethodPut, "/api/songs/tags",
		map[string]any{"ids": []any{1, 2}, "tags": map[string]any{"title": "T"}}, nil, admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("non-string ids: want 400, got %d", rec.Code)
	}

	// A full pass writes every song.
	s.writer.calls = nil
	rec = s.do(t, http.MethodPut, "/api/songs/tags",
		map[string]any{"ids": []any{first, second}, "tags": map[string]any{"title": "T"}}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if len(s.writer.calls) != 2 {
		t.Fatalf("writer calls = %d, want 2", len(s.writer.calls))
	}
}

func TestPutAlbumTagsFlow(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	first, _ := s.seedSong(t, "spike.mp3", "a1.mp3")
	second, _ := s.seedSong(t, "spike.ogg", "a2.ogg")
	var albumID string
	if err := s.db.QueryRow(`SELECT album_id FROM songs WHERE id = ?`, first).Scan(&albumID); err != nil {
		t.Fatal(err)
	}
	// Attach the second song to the same album row directly.
	if _, err := s.db.Exec(`UPDATE songs SET album_id = ? WHERE id = ?`, albumID, second); err != nil {
		t.Fatal(err)
	}

	rec := s.do(t, http.MethodPut, "/api/albums/"+albumID+"/tags", map[string]any{
		"albumArtist": []any{"New Album Artist"},
		"year":        1984,
		"genre":       "Post Punk",
		"releaseType": "Album",
	}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if updated := decode(t, rec)["updated"]; updated != float64(2) {
		t.Fatalf("updated = %v, want 2", updated)
	}

	// Both files were written.
	if len(s.writer.calls) != 2 {
		t.Fatalf("writer calls = %d, want 2", len(s.writer.calls))
	}

	// Album row + junctions updated.
	var name, releaseType, genreName string
	var year int
	if err := s.db.QueryRow(`SELECT name, year, genre, release_type FROM albums WHERE id = ?`, albumID).
		Scan(&name, &year, &genreName, &releaseType); err != nil {
		t.Fatal(err)
	}
	if year != 1984 || releaseType != "Album" || genreName != "Post Punk" {
		t.Fatalf("album row = %s/%d/%s/%s", name, year, genreName, releaseType)
	}
	var junctions int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM album_artists WHERE album_id = ?`, albumID).Scan(&junctions); err != nil {
		t.Fatal(err)
	}
	if junctions != 1 {
		t.Fatalf("album_artists = %d, want 1", junctions)
	}
	var artistName string
	if err := s.db.QueryRow(
		`SELECT ar.name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id WHERE aa.album_id = ?`, albumID).
		Scan(&artistName); err != nil {
		t.Fatal(err)
	}
	if artistName != "New Album Artist" {
		t.Fatalf("album artist = %q", artistName)
	}

	// ONE coalesced resync for the whole album edit.
	var resyncCount int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM scan_jobs WHERE type = 'resync'`).Scan(&resyncCount); err != nil {
		t.Fatal(err)
	}
	if resyncCount != 1 {
		t.Fatalf("resync jobs = %d, want 1 (coalesced)", resyncCount)
	}

	// releaseType type check.
	if rec := s.do(t, http.MethodPut, "/api/albums/"+albumID+"/tags",
		map[string]any{"releaseType": 7}, nil, admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("releaseType type: want 400, got %d", rec.Code)
	}
}

// minimalPNG is a 1x1 transparent PNG (magic bytes + valid structure).
var minimalPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
	0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
	0x1f, 0x15, 0xc4, 0x89,
}

var minimalJPEG = []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F'}

func TestSongCoverArtUpload(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	songID, _ := s.seedSong(t, "spike.mp3", "cover.mp3")

	// Declared image/png with text bytes: rejected by the magic-byte sniff.
	rec := s.do(t, http.MethodPost, "/api/songs/"+songID+"/cover-art", nil, []byte("definitely not an image"), admin)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("fake png: want 400, got %d", rec.Code)
	}
	if got := decode(t, rec)["error"]; got != "Invalid image format" {
		t.Fatalf("error = %v", got)
	}

	// Oversized.
	if rec := s.do(t, http.MethodPost, "/api/songs/"+songID+"/cover-art", nil, append(minimalPNG, make([]byte, 2<<20)...), admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized: want 400, got %d", rec.Code)
	}

	// Valid upload links the blob.
	rec = s.do(t, http.MethodPost, "/api/songs/"+songID+"/cover-art", nil, minimalPNG, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	coverID := decode(t, rec)["coverArt"].(string)

	// Re-uploading the same bytes dedups to the same id.
	rec = s.do(t, http.MethodPost, "/api/songs/"+songID+"/cover-art", nil, minimalPNG, admin)
	if decode(t, rec)["coverArt"].(string) != coverID {
		t.Fatal("same bytes produced a different cover art id")
	}
	var storedFormat string
	if err := s.db.QueryRow(`SELECT format FROM cover_arts WHERE id = ?`, coverID).Scan(&storedFormat); err != nil {
		t.Fatal(err)
	}
	if storedFormat != "image/png" {
		t.Fatalf("stored format = %q", storedFormat)
	}

	// A different format replaces the link and orphans the old blob: the
	// count stays at 2 (the seeded song's embedded-art blob + the jpeg)
	// because the orphaned png is cleaned up on replacement.
	rec = s.do(t, http.MethodPost, "/api/songs/"+songID+"/cover-art", nil, minimalJPEG, admin)
	newCover := decode(t, rec)["coverArt"].(string)
	if newCover == coverID {
		t.Fatal("different bytes must produce a different id")
	}
	var blobCount int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cover_arts`).Scan(&blobCount); err != nil {
		t.Fatal(err)
	}
	if blobCount != 2 {
		t.Fatalf("blobs = %d, want 2 (embedded-art blob + jpeg; orphaned png cleaned)", blobCount)
	}

	// Delete unlinks and cleans the orphan up.
	rec = s.do(t, http.MethodDelete, "/api/songs/"+songID+"/cover-art", nil, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d", rec.Code)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cover_arts`).Scan(&blobCount); err != nil {
		t.Fatal(err)
	}
	if blobCount != 1 {
		t.Fatalf("after unlink: blobs = %d, want 1 (orphan removed)", blobCount)
	}
	var link *string
	if err := s.db.QueryRow(`SELECT cover_art_id FROM songs WHERE id = ?`, songID).Scan(&link); err != nil {
		t.Fatal(err)
	}
	if link != nil {
		t.Fatal("cover link still set after delete")
	}

	// 404s.
	if rec := s.do(t, http.MethodPost, "/api/songs/nope/cover-art", nil, minimalPNG, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown song upload: want 404, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/songs/nope/cover-art", nil, nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown song delete: want 404, got %d", rec.Code)
	}
}

func TestAlbumCoverArtUpload(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	songID, _ := s.seedSong(t, "spike.mp3", "album-cover.mp3")
	var albumID string
	if err := s.db.QueryRow(`SELECT album_id FROM songs WHERE id = ?`, songID).Scan(&albumID); err != nil {
		t.Fatal(err)
	}

	if rec := s.do(t, http.MethodPost, "/api/albums/nope/cover-art", nil, minimalPNG, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown album: want 404, got %d", rec.Code)
	}
	rec := s.do(t, http.MethodPost, "/api/albums/"+albumID+"/cover-art", nil, minimalPNG, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var linked string
	if err := s.db.QueryRow(`SELECT cover_art_id FROM albums WHERE id = ?`, albumID).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked != decode(t, rec)["coverArt"].(string) {
		t.Fatal("album link does not point at the stored blob")
	}

	if rec := s.do(t, http.MethodDelete, "/api/albums/"+albumID+"/cover-art", nil, nil, admin); rec.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d", rec.Code)
	}
}

// TestTagEditEndToEndWithMutagen runs the real write path: tag edit through
// the HTTP route against a corpus copy, verifying the file's new location,
// its rewritten tags, and the database row. Skipped without python3+mutagen.
func TestTagEditEndToEndWithMutagen(t *testing.T) {
	if err := exec.Command("python3", "-c", "import mutagen").Run(); err != nil {
		t.Skip("python3+mutagen not available on this host")
	}
	s := newServer(t)
	// Swap the fake writer for the real one.
	s.writer.err = nil
	realSvc := tags.NewService(s.db, audio.NewMutagenWriter(),
		ingest.NewService(s.db, discardLogger(), library.NewQueue(s.db), ingest.Options{
			LibraryPath:         s.libDir,
			ReviewRetentionDays: 30,
		}), library.NewQueue(s.db))
	admin := s.session(t, "u-admin", "admin", true)

	// Rebuild the router against the real-writer service.
	store := auth.NewStore(s.db)
	mw := auth.NewMiddleware(store, s.db, testSecret, false)
	r := chi.NewRouter()
	tags.NewHandler(realSvc, mw).Routes(r)
	s.router = r

	songID, _ := s.seedSong(t, "spike.mp3", "e2e.mp3")
	rec := s.do(t, http.MethodPut, "/api/songs/"+songID+"/tags", map[string]any{
		"title":  "End To End",
		"artist": []any{"E2E Artist"},
		"album":  "E2E Album",
		"year":   2001,
	}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("tag edit: want 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	var newPath string
	if err := s.db.QueryRow(`SELECT file_path FROM songs WHERE id = ?`, songID).Scan(&newPath); err != nil {
		t.Fatal(err)
	}
	meta, err := audio.ReadMetadata(newPath)
	if err != nil {
		t.Fatalf("read moved file: %v", err)
	}
	if meta.Title != "End To End" || meta.Album != "E2E Album" || meta.Year != 2001 {
		t.Fatalf("file tags = %q/%q/%d", meta.Title, meta.Album, meta.Year)
	}
	if len(meta.Artists) != 1 || meta.Artists[0] != "E2E Artist" {
		t.Fatalf("artists = %v", meta.Artists)
	}
	var title string
	if err := s.db.QueryRow(`SELECT title FROM songs WHERE id = ?`, songID).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != "End To End" {
		t.Fatalf("db title = %q", title)
	}
}
