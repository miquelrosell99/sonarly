package catalog_test

import (
	"net/http"
	"testing"
)

// ---------------------------------------------------------------------------
// Guest share-token access (GET /api/cover-art/{id}?share=...): anonymous
// viewers of a link-shared playlist may fetch artwork belonging to the
// playlist's songs (or their albums'). Anonymous without a token gets 401;
// a token that grants nothing — unknown, private-playlist, or scoped to a
// different playlist — gets 404, so tokens cannot be probed. Signed-in
// callers take the session path; a bogus share param never overrides it.
// ---------------------------------------------------------------------------

func TestCoverArtShareToken(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)

	// Two link-shared playlists with disjoint songs (s-a1 → art ca-s1, album
	// art ca-a1; s-b1 → album art ca-b1), plus a private playlist carrying a
	// token that must NOT grant anything (link-only coupling).
	s.mustExec(t, `INSERT INTO playlists (id, name, owner_id, visibility, share_token, is_smart) VALUES
		('pl-a',    'Shared A', 'user-alice', 'link',    'tok-a',    0),
		('pl-b',    'Shared B', 'user-carol', 'link',    'tok-b',    0),
		('pl-priv', 'Private',  'user-alice', 'private', 'tok-priv', 0)`)
	s.mustExec(t, `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES
		('pl-a', 's-a1', 0), ('pl-b', 's-b1', 0), ('pl-priv', 's-a1', 0)`)

	t.Run("valid token serves the song's own art", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-s1?share=tok-a", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if ct := rec.Result().Header.Get("Content-Type"); ct != "image/png" {
			t.Errorf("Content-Type: %q", ct)
		}
		if cc := rec.Result().Header.Get("Cache-Control"); cc != "private, max-age=86400" {
			t.Errorf("Cache-Control: %q", cc)
		}
		if rec.Body.Len() == 0 {
			t.Error("body must be the blob")
		}
	})

	t.Run("valid token serves the song's album art", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-a1?share=tok-a", nil)
		if rec.Code != http.StatusOK || rec.Result().Header.Get("Content-Type") != "image/jpeg" {
			t.Errorf("got %d ct %q", rec.Code, rec.Result().Header.Get("Content-Type"))
		}
	})

	t.Run("anonymous without a token is 401", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-s1", nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("want 401, got %d", rec.Code)
		}
	})

	t.Run("unknown token is 404", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-s1?share=nope", nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})

	t.Run("token of a private playlist grants nothing", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-s1?share=tok-priv", nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})

	t.Run("token scoped to another playlist cannot fetch its art", func(t *testing.T) {
		// ca-b1 is reachable only through playlist B's song s-b1; token A's
		// playlist does not contain it.
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-b1?share=tok-a", nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})

	t.Run("the other playlist's own token serves its art", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-b1?share=tok-b", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("unreferenced art with a valid token is 404", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-orphan?share=tok-a", nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})

	t.Run("session identity wins over a bogus token", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-a1?share=nope", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", rec.Code)
		}
	})
}
