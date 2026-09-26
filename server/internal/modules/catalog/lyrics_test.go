// GET /api/songs/{id}/lyrics: scoped like every other song read, both
// fields ride the wire as nullable strings (synced lyrics in LRC text).
package catalog_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// seedLyricsShapes points three fixture songs at the three synced_lyrics
// storage shapes: JSON lines (the one-data-path format), raw LRC text (the
// lyrics PUT format), and NULL.
func seedLyricsShapes(t *testing.T, s *server) {
	t.Helper()
	s.mustExec(t, `UPDATE songs SET lyrics = 'la la', synced_lyrics = '[{"time":1.5,"text":"hey"}]' WHERE id = 's-a1'`)
	s.mustExec(t, `UPDATE songs SET synced_lyrics = '[00:02.00] raw' WHERE id = 's-a2'`)
	s.mustExec(t, `UPDATE songs SET synced_lyrics = NULL WHERE id = 's-a3'`)
}

func lyricsPayload(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	body := decodeMap(t, rec)
	lyrics, ok := body["lyrics"].(map[string]any)
	if !ok {
		t.Fatalf("response has no lyrics object: %v", body)
	}
	return lyrics
}

func TestGetSongLyrics(t *testing.T) {
	s := newSeededServer(t)
	seedLyricsShapes(t, s)
	admin := s.session(t, "user-admin", "root", true)

	rec := s.do(t, http.MethodGet, "/api/songs/s-a1/lyrics", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got := lyricsPayload(t, rec)
	if got["lyrics"] != "la la" {
		t.Fatalf("lyrics: %v", got)
	}
	if got["syncedLyrics"] != "[00:01.50] hey" {
		t.Fatalf("JSON-lines column must render as LRC: %v", got)
	}

	// Raw LRC text (lyrics PUT format) passes through untouched.
	rec = s.do(t, http.MethodGet, "/api/songs/s-a2/lyrics", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if got := lyricsPayload(t, rec); got["syncedLyrics"] != "[00:02.00] raw" {
		t.Fatalf("LRC text must pass through: %v", got)
	}

	// NULL column -> explicit nulls.
	rec = s.do(t, http.MethodGet, "/api/songs/s-a3/lyrics", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	got = lyricsPayload(t, rec)
	if got["lyrics"] != nil || got["syncedLyrics"] != nil {
		t.Fatalf("null columns must serialize as null: %v", got)
	}
}

func TestGetSongLyricsScoped(t *testing.T) {
	s := newSeededServer(t)
	seedLyricsShapes(t, s)
	alice := s.session(t, "user-alice", "alice", false) // lib-a: in scope for s-a1
	carol := s.session(t, "user-carol", "carol", false) // lib-b: out of scope
	bob := s.session(t, "user-bob", "bob", false)       // no libraries

	if rec := s.do(t, http.MethodGet, "/api/songs/s-a1/lyrics", alice); rec.Code != http.StatusOK {
		t.Fatalf("alice must read s-a1: got %d", rec.Code)
	}
	for _, user := range []*http.Cookie{carol, bob} {
		if rec := s.do(t, http.MethodGet, "/api/songs/s-a1/lyrics", user); rec.Code != http.StatusNotFound {
			t.Fatalf("out-of-scope must 404: got %d", rec.Code)
		}
	}
	if rec := s.do(t, http.MethodGet, "/api/songs/s-a1/lyrics", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodGet, "/api/songs/nope/lyrics", alice); rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}
