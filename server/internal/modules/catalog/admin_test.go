// Admin write-path tests: entity deletes (DELETE /api/songs|albums|artists)
// and genre create/rename (POST|PUT /api/genres). Files are real temp files;
// the seeded library rows point at them via file_path updates.
package catalog_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// doBody issues a request with a JSON body.
func (s *server) doBody(t *testing.T, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
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

// pointFile moves a fixture song's file_path at a real temp file and returns
// the path.
func (s *server) pointFile(t *testing.T, songID string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), songID+".flac")
	if err := os.WriteFile(path, []byte("audio"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.mustExec(t, `UPDATE songs SET file_path = ? WHERE id = ?`, path, songID)
	return path
}

func fileExists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	return err == nil
}

func rowCount(t *testing.T, s *server, query string, args ...any) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// ---------------------------------------------------------------------------
// DELETE /api/songs/{id}
// ---------------------------------------------------------------------------

func TestDeleteSong(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	path := s.pointFile(t, "s-a1")

	rec := s.do(t, http.MethodDelete, "/api/songs/s-a1", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if body := decodeMap(t, rec); body["ok"] != true {
		t.Fatalf("want {ok:true}, got %v", body)
	}
	if fileExists(t, path) {
		t.Fatal("file must be unlinked")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM songs WHERE id = 's-a1'`); n != 0 {
		t.Fatal("song row must be gone")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM song_artists WHERE song_id = 's-a1'`); n != 0 {
		t.Fatal("junction rows must cascade")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM user_songs WHERE song_id = 's-a1'`); n != 0 {
		t.Fatal("per-user rows must cascade")
	}
}

func TestDeleteSongMissingFileTolerated(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	s.mustExec(t, `UPDATE songs SET file_path = '/does/not/exist.flac' WHERE id = 's-a1'`)

	rec := s.do(t, http.MethodDelete, "/api/songs/s-a1", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("missing file must be tolerated: got %d: %s", rec.Code, rec.Body.String())
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM songs WHERE id = 's-a1'`); n != 0 {
		t.Fatal("song row must be gone")
	}
}

func TestDeleteSongNotFound(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	if rec := s.do(t, http.MethodDelete, "/api/songs/nope", admin); rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestDeleteSongRequiresAdmin(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	if rec := s.do(t, http.MethodDelete, "/api/songs/s-a1", alice); rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/songs/s-a1", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM songs WHERE id = 's-a1'`); n != 1 {
		t.Fatal("song must survive the rejected deletes")
	}
}

// ---------------------------------------------------------------------------
// DELETE /api/albums/{id}
// ---------------------------------------------------------------------------

func TestDeleteAlbum(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	p1 := s.pointFile(t, "s-a1")
	p2 := s.pointFile(t, "s-a2")

	rec := s.do(t, http.MethodDelete, "/api/albums/al-a1", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if body := decodeMap(t, rec); body["ok"] != true {
		t.Fatalf("want {ok:true}, got %v", body)
	}
	for _, path := range []string{p1, p2} {
		if fileExists(t, path) {
			t.Fatalf("file must be unlinked: %s", path)
		}
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM songs WHERE album_id = 'al-a1'`); n != 0 {
		t.Fatal("album songs must be gone")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM albums WHERE id = 'al-a1'`); n != 0 {
		t.Fatal("album row must be gone")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM albums WHERE id = 'al-a2'`); n != 1 {
		t.Fatal("other albums must survive")
	}
}

func TestDeleteAlbumNotFound(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	if rec := s.do(t, http.MethodDelete, "/api/albums/nope", admin); rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestDeleteAlbumRequiresAdmin(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	if rec := s.do(t, http.MethodDelete, "/api/albums/al-a1", alice); rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// DELETE /api/artists/{id}
// ---------------------------------------------------------------------------

func TestDeleteArtistWithActiveSongs(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	// ar-alpha carries active songs directly.
	if rec := s.do(t, http.MethodDelete, "/api/artists/ar-alpha", admin); rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	// ar-feat reaches an active song only through song_artists.
	if rec := s.do(t, http.MethodDelete, "/api/artists/ar-feat", admin); rec.Code != http.StatusConflict {
		t.Fatalf("junction-only artist: want 409, got %d", rec.Code)
	}
	// ar-comp reaches active songs only through song_composers.
	if rec := s.do(t, http.MethodDelete, "/api/artists/ar-comp", admin); rec.Code != http.StatusConflict {
		t.Fatalf("composer-only artist: want 409, got %d", rec.Code)
	}
}

func TestDeleteArtist(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	// ar-gamma: no active songs (s-ia is inactive), one empty album (al-c1),
	// junction rows from the inactive song.
	rec := s.do(t, http.MethodDelete, "/api/artists/ar-gamma", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if body := decodeMap(t, rec); body["ok"] != true {
		t.Fatalf("want {ok:true}, got %v", body)
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM artists WHERE id = 'ar-gamma'`); n != 0 {
		t.Fatal("artist row must be gone")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM albums WHERE id = 'al-c1'`); n != 0 {
		t.Fatal("empty album must be gone")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM song_artists WHERE artist_id = 'ar-gamma'`); n != 0 {
		t.Fatal("leftover junction rows must be cleaned")
	}
	var orphaned int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM songs WHERE id = 's-ia' AND artist_id IS NULL`).Scan(&orphaned); err != nil {
		t.Fatal(err)
	}
	if orphaned != 1 {
		t.Fatal("the inactive song must survive with its artist FK nulled")
	}
}

func TestDeleteArtistNotFound(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	if rec := s.do(t, http.MethodDelete, "/api/artists/nope", admin); rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// POST /api/genres + PUT /api/genres/{id}
// ---------------------------------------------------------------------------

func genrePayload(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	body := decodeMap(t, rec)
	genre, ok := body["genre"].(map[string]any)
	if !ok {
		t.Fatalf("response has no genre object: %v", body)
	}
	return genre
}

func TestCreateGenre(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)

	rec := s.doBody(t, http.MethodPost, "/api/genres", map[string]any{"name": "Blues"}, admin)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	genre := genrePayload(t, rec)
	if genre["name"] != "Blues" || genre["path"] != "Blues" || genre["active"] != true {
		t.Fatalf("unexpected genre: %v", genre)
	}
}

func TestCreateGenreChild(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)

	rec := s.doBody(t, http.MethodPost, "/api/genres",
		map[string]any{"name": "Minimal", "parentId": "g-techno"}, admin)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	genre := genrePayload(t, rec)
	if genre["path"] != "Electronic > Techno > Minimal" {
		t.Fatalf("child path: %v", genre)
	}
	if genre["parentId"] != "g-techno" {
		t.Fatalf("parentId: %v", genre)
	}
}

func TestCreateGenreValidation(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	cases := []struct {
		name string
		body map[string]any
		want int
	}{
		{"missing name", map[string]any{}, http.StatusBadRequest},
		{"empty name", map[string]any{"name": "   "}, http.StatusBadRequest},
		{"non-string name", map[string]any{"name": 42}, http.StatusBadRequest},
		{"unknown field", map[string]any{"name": "X", "active": false}, http.StatusBadRequest},
		{"non-string parentId", map[string]any{"name": "X", "parentId": 5}, http.StatusBadRequest},
		{"missing parent", map[string]any{"name": "X", "parentId": "nope"}, http.StatusNotFound},
		{"duplicate name", map[string]any{"name": "jazz"}, http.StatusConflict},
	}
	for _, tc := range cases {
		rec := s.doBody(t, http.MethodPost, "/api/genres", tc.body, admin)
		if rec.Code != tc.want {
			t.Errorf("%s: want %d, got %d: %s", tc.name, tc.want, rec.Code, rec.Body.String())
		}
	}
}

func TestCreateGenreRequiresAdmin(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.doBody(t, http.MethodPost, "/api/genres", map[string]any{"name": "X"}, alice)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

func TestRenameGenre(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	// An inactive song carrying the genre must NOT be cache-refreshed.
	s.mustExec(t, `UPDATE songs SET genre = 'Jazz', genre_id = 'g-jazz' WHERE id = 's-ia'`)

	rec := s.doBody(t, http.MethodPut, "/api/genres/g-jazz", map[string]any{"name": "Bebop"}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	genre := genrePayload(t, rec)
	if genre["name"] != "Bebop" || genre["path"] != "Bebop" {
		t.Fatalf("unexpected genre: %v", genre)
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM songs WHERE genre_id = 'g-jazz' AND active = 1 AND genre = 'Bebop'`); n == 0 {
		t.Fatal("active song genre cache must follow the rename")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM albums WHERE genre_id = 'g-jazz' AND genre = 'Bebop'`); n == 0 {
		t.Fatal("album genre cache must follow the rename")
	}
	var stale string
	if err := s.db.QueryRow(`SELECT genre FROM songs WHERE id = 's-ia'`).Scan(&stale); err != nil {
		t.Fatal(err)
	}
	if stale != "Jazz" {
		t.Fatalf("inactive song cache must stay: %q", stale)
	}
}

func TestRenameGenreConflictsAndValidation(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	cases := []struct {
		name string
		path string
		body map[string]any
		want int
	}{
		{"missing genre", "/api/genres/nope", map[string]any{"name": "X"}, http.StatusNotFound},
		{"duplicate name", "/api/genres/g-jazz", map[string]any{"name": "techno"}, http.StatusConflict},
		{"missing name and parentId", "/api/genres/g-jazz", map[string]any{}, http.StatusBadRequest},
		{"empty name", "/api/genres/g-jazz", map[string]any{"name": " "}, http.StatusBadRequest},
		{"unknown field", "/api/genres/g-jazz", map[string]any{"name": "X", "active": false}, http.StatusBadRequest},
		{"non-string parentId", "/api/genres/g-jazz", map[string]any{"parentId": 5}, http.StatusBadRequest},
	}
	for _, tc := range cases {
		rec := s.doBody(t, http.MethodPut, tc.path, tc.body, admin)
		if rec.Code != tc.want {
			t.Errorf("%s: want %d, got %d: %s", tc.name, tc.want, rec.Code, rec.Body.String())
		}
	}
}

func TestRenameGenreRequiresAdmin(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.doBody(t, http.MethodPut, "/api/genres/g-jazz", map[string]any{"name": "X"}, alice)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// PUT /api/genres/{id} moves (parentId)
// ---------------------------------------------------------------------------

func TestMoveGenre(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)

	// Techno lands under Jazz, path included.
	rec := s.doBody(t, http.MethodPut, "/api/genres/g-techno", map[string]any{"parentId": "g-jazz"}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	genre := genrePayload(t, rec)
	if genre["parentId"] != "g-jazz" {
		t.Fatalf("parentId: %v", genre)
	}
	if genre["path"] != "Jazz > Techno" {
		t.Fatalf("path: %v", genre)
	}
	var parentID any
	if err := s.db.QueryRow(`SELECT parent_id FROM genres WHERE id = 'g-techno'`).Scan(&parentID); err != nil {
		t.Fatal(err)
	}
	if parentID != "g-jazz" {
		t.Fatalf("stored parent_id: %v", parentID)
	}

	// name and parentId may ride one request (old updateGenre shape).
	rec = s.doBody(t, http.MethodPut, "/api/genres/g-techno",
		map[string]any{"name": "Detroit Techno", "parentId": "g-elect"}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("combined rename+move: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	genre = genrePayload(t, rec)
	if genre["name"] != "Detroit Techno" || genre["path"] != "Electronic > Detroit Techno" {
		t.Fatalf("combined rename+move: %v", genre)
	}
	// The rename half of the combined write refreshes the name cache.
	if n := rowCount(t, s, `SELECT COUNT(*) FROM songs WHERE genre_id = 'g-techno' AND genre = 'Detroit Techno'`); n == 0 {
		t.Fatal("song genre cache must follow the combined rename")
	}
}

func TestMoveGenreToRoot(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)

	// The admin UI sends parentId: null for "no parent".
	rec := s.doBody(t, http.MethodPut, "/api/genres/g-ambient", map[string]any{"parentId": nil}, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	genre := genrePayload(t, rec)
	if _, present := genre["parentId"]; present {
		t.Fatalf("root genre must omit parentId: %v", genre)
	}
	if genre["path"] != "Ambient" {
		t.Fatalf("path: %v", genre)
	}
	// Drift still resolves under Ambient: paths follow the active set.
	if n := rowCount(t, s, `SELECT COUNT(*) FROM genres WHERE id = 'g-ambient' AND parent_id IS NULL`); n != 1 {
		t.Fatal("parent_id must be NULL in storage")
	}
}

func TestMoveGenreValidation(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	cases := []struct {
		name string
		path string
		body map[string]any
		want int
	}{
		{"missing genre", "/api/genres/nope", map[string]any{"parentId": "g-elect"}, http.StatusNotFound},
		{"missing parent", "/api/genres/g-techno", map[string]any{"parentId": "nope"}, http.StatusNotFound},
		{"self is a no-op", "/api/genres/g-techno", map[string]any{"parentId": "g-techno"}, http.StatusOK},
		{"empty body", "/api/genres/g-techno", map[string]any{}, http.StatusBadRequest},
		{"unknown field", "/api/genres/g-techno", map[string]any{"parentId": "g-jazz", "active": false}, http.StatusBadRequest},
	}
	for _, tc := range cases {
		rec := s.doBody(t, http.MethodPut, tc.path, tc.body, admin)
		if rec.Code != tc.want {
			t.Errorf("%s: want %d, got %d: %s", tc.name, tc.want, rec.Code, rec.Body.String())
		}
	}
	// The self-move no-op must not have reparented anything.
	if n := rowCount(t, s, `SELECT COUNT(*) FROM genres WHERE id = 'g-techno' AND parent_id = 'g-elect'`); n != 1 {
		t.Fatal("self move must leave the parent untouched")
	}
}

func TestMoveGenreRequiresAdmin(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.doBody(t, http.MethodPut, "/api/genres/g-techno", map[string]any{"parentId": "g-jazz"}, alice)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM genres WHERE id = 'g-techno' AND parent_id = 'g-elect'`); n != 1 {
		t.Fatal("genre must survive the rejected move")
	}
}

// ---------------------------------------------------------------------------
// DELETE /api/genres/{id}
// ---------------------------------------------------------------------------

func TestDeleteGenre(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)

	rec := s.do(t, http.MethodDelete, "/api/genres/g-techno", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if body := decodeMap(t, rec); body["ok"] != true {
		t.Fatalf("want {ok:true}, got %v", body)
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM genres WHERE id = 'g-techno'`); n != 0 {
		t.Fatal("genre row must be gone")
	}
	// The carrier references are nulled, the rows survive.
	if n := rowCount(t, s, `SELECT COUNT(*) FROM songs WHERE id = 's-a3' AND genre_id IS NULL AND genre = 'Techno'`); n != 1 {
		t.Fatal("song must survive with genre_id nulled and its name cache untouched")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM albums WHERE id = 'al-a2' AND genre_id IS NULL AND genre = 'Techno'`); n != 1 {
		t.Fatal("album must survive with genre_id nulled and its name cache untouched")
	}
	// Junction rows cascade through the schema's ON DELETE CASCADE FKs.
	if n := rowCount(t, s, `SELECT COUNT(*) FROM song_genres WHERE genre_id = 'g-techno'`); n != 0 {
		t.Fatal("song_genres junction rows must cascade")
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM album_genres WHERE genre_id = 'g-techno'`); n != 0 {
		t.Fatal("album_genres junction rows must cascade")
	}
	// s-a2 carries Jazz alongside Techno; that junction row survives.
	if n := rowCount(t, s, `SELECT COUNT(*) FROM song_genres WHERE song_id = 's-a2' AND genre_id = 'g-jazz'`); n != 1 {
		t.Fatal("sibling junction rows must survive")
	}
}

func TestDeleteGenreWithChildren(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	// g-elect has two active children (Ambient, Techno).
	if rec := s.do(t, http.MethodDelete, "/api/genres/g-elect", admin); rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM genres WHERE id = 'g-elect'`); n != 1 {
		t.Fatal("genre must survive the rejected delete")
	}
}

func TestDeleteGenreNotFound(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	if rec := s.do(t, http.MethodDelete, "/api/genres/nope", admin); rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestDeleteGenreRequiresAdmin(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	if rec := s.do(t, http.MethodDelete, "/api/genres/g-techno", alice); rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodDelete, "/api/genres/g-techno", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
	if n := rowCount(t, s, `SELECT COUNT(*) FROM genres WHERE id = 'g-techno'`); n != 1 {
		t.Fatal("genre must survive the rejected deletes")
	}
}
