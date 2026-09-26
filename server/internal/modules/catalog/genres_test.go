package catalog_test

import (
	"fmt"
	"net/http"
	"testing"
)

// ---------------------------------------------------------------------------
// Genres: flat list, tree pruning, albums-by-genre
// ---------------------------------------------------------------------------

func genreList(t *testing.T, s *server, cookie *http.Cookie, path string) []map[string]any {
	t.Helper()
	rec := s.do(t, http.MethodGet, path, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: want 200, got %d: %s", path, rec.Code, rec.Body.String())
	}
	body := decodeMap(t, rec)
	raw, ok := body["genres"].([]any)
	if !ok {
		t.Fatalf("no genres array: %v", body)
	}
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		out = append(out, item.(map[string]any))
	}
	return out
}

func TestListGenresScopeMatrix(t *testing.T) {
	s := newSeededServer(t)

	// Admin: every active genre with its full path.
	admin := genreList(t, s, s.session(t, "user-admin", "root", true), "/api/genres")
	wantPaths := map[string]string{
		"g-elect":   "Electronic",
		"g-ambient": "Electronic > Ambient",
		"g-drift":   "Electronic > Ambient > Drift",
		"g-techno":  "Electronic > Techno",
		"g-jazz":    "Jazz",
	}
	if len(admin) != len(wantPaths) {
		t.Fatalf("admin genres: %v", admin)
	}
	for _, g := range admin {
		if wantPaths[g["id"].(string)] != g["path"].(string) {
			t.Errorf("path for %s: want %q, got %q", g["id"], wantPaths[g["id"].(string)], g["path"])
		}
		if g["active"] != true {
			t.Errorf("genre must be active: %v", g)
		}
	}

	// Alice: only genres with in-scope songs — no out-of-scope carriers.
	alice := genreList(t, s, s.session(t, "user-alice", "alice", false), "/api/genres")
	ids := make([]string, 0, len(alice))
	for _, g := range alice {
		ids = append(ids, g["id"].(string))
	}
	expectIDs(t, ids, "g-jazz", "g-techno", "g-drift")

	// Bob: nothing.
	if bob := genreList(t, s, s.session(t, "user-bob", "bob", false), "/api/genres"); len(bob) != 0 {
		t.Errorf("bob must see no genres: %v", bob)
	}
}

func TestGenreTreeScopeMatrix(t *testing.T) {
	s := newSeededServer(t)

	type node struct {
		id       string
		children []node
	}
	flatten := func(ns []map[string]any) []node {
		out := make([]node, 0, len(ns))
		for _, n := range ns {
			var kids []node
			if raw, ok := n["children"].([]any); ok {
				for _, c := range raw {
					cm := c.(map[string]any)
					var gk []node
					if craw, ok := cm["children"].([]any); ok {
						for _, cc := range craw {
							ccm := cc.(map[string]any)
							gk = append(gk, node{id: ccm["id"].(string)})
						}
					}
					kids = append(kids, node{id: cm["id"].(string), children: gk})
				}
			}
			out = append(out, node{id: n["id"].(string), children: kids})
		}
		return out
	}
	tree := func(cookie *http.Cookie) []node {
		rec := s.do(t, http.MethodGet, "/api/genres/tree", cookie)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		body := decodeMap(t, rec)
		raw, ok := body["tree"].([]any)
		if !ok {
			t.Fatalf("no tree: %v", body)
		}
		ns := make([]map[string]any, 0, len(raw))
		for _, item := range raw {
			ns = append(ns, item.(map[string]any))
		}
		return flatten(ns)
	}

	t.Run("admin full tree", func(t *testing.T) {
		got := tree(s.session(t, "user-admin", "root", true))
		want := []node{
			{id: "g-elect", children: []node{
				{id: "g-ambient", children: []node{{id: "g-drift"}}},
				{id: "g-techno"},
			}},
			{id: "g-jazz"},
		}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("tree: want %v, got %v", want, got)
		}
	})

	t.Run("scoped tree keeps carriers for in-scope children", func(t *testing.T) {
		// g-techno and g-drift have in-scope songs for alice. Their
		// out-of-scope ancestors survive as structural carriers, so the
		// children stay nested under their real parents (v1 prune rule);
		// g-ambient's branch survives only through g-drift.
		got := tree(s.session(t, "user-alice", "alice", false))
		want := []node{
			{id: "g-elect", children: []node{
				{id: "g-ambient", children: []node{{id: "g-drift"}}},
				{id: "g-techno"},
			}},
			{id: "g-jazz"},
		}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("tree: want %v, got %v", want, got)
		}
	})

	t.Run("empty scope gives empty tree", func(t *testing.T) {
		if got := tree(s.session(t, "user-bob", "bob", false)); len(got) != 0 {
			t.Errorf("tree must be empty: %v", got)
		}
	})
}

func TestGenreTreePathsSetAfterPrune(t *testing.T) {
	s := newSeededServer(t)
	rec := s.do(t, http.MethodGet, "/api/genres/tree", s.session(t, "user-alice", "alice", false))
	body := decodeMap(t, rec)
	var walk func(ns []any) bool
	ok := true
	walk = func(ns []any) bool {
		for _, item := range ns {
			n := item.(map[string]any)
			if _, present := n["path"]; !present {
				t.Errorf("node %s has no path", n["id"])
				ok = false
			}
			if children, present := n["children"].([]any); present {
				walk(children)
			}
		}
		return ok
	}
	walk(body["tree"].([]any))
}

func TestGenreAlbums(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	alice := s.session(t, "user-alice", "alice", false)

	t.Run("scoped to in-scope albums", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/genres/g-techno/albums", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", rec.Code)
		}
		expectIDs(t, albumIDList(t, rec), "al-a2")
	})
	t.Run("out of scope genre albums empty", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/genres/g-ambient/albums", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", rec.Code)
		}
		if albums := albumIDList(t, rec); len(albums) != 0 {
			t.Errorf("want none, got %v", albums)
		}
	})
	t.Run("admin sees genre albums across libraries", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/genres/g-ambient/albums?limit=20", admin)
		expectIDs(t, albumIDList(t, rec), "al-b1", "al-b2")
	})
	t.Run("limit clamps", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/genres/g-ambient/albums?limit=1", admin)
		if albums := albumIDList(t, rec); len(albums) != 1 {
			t.Errorf("limit=1 must return one album: %v", albums)
		}
	})
	t.Run("hide explicit drops all-explicit albums", func(t *testing.T) {
		// al-b1 has only explicit songs; al-b2 has s-b3 (non-explicit).
		rec := s.do(t, http.MethodGet, "/api/genres/g-ambient/albums?limit=20&hideExplicit=true", admin)
		expectIDs(t, albumIDList(t, rec), "al-b2")
	})
	t.Run("unknown genre is 404", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/genres/nope/albums", admin)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})
}

// ---------------------------------------------------------------------------
// Cover art
// ---------------------------------------------------------------------------

func TestCoverArt(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	alice := s.session(t, "user-alice", "alice", false)
	carol := s.session(t, "user-carol", "carol", false)

	t.Run("album art in scope", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-a1", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if ct := rec.Result().Header.Get("Content-Type"); ct != "image/jpeg" {
			t.Errorf("Content-Type: %q", ct)
		}
		if cc := rec.Result().Header.Get("Cache-Control"); cc != "private, max-age=86400" {
			t.Errorf("Cache-Control: %q", cc)
		}
		if rec.Body.Len() == 0 {
			t.Error("body must be the blob")
		}
	})
	t.Run("song art in scope", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-s1", alice)
		if rec.Code != http.StatusOK || rec.Result().Header.Get("Content-Type") != "image/png" {
			t.Errorf("got %d ct %q", rec.Code, rec.Result().Header.Get("Content-Type"))
		}
	})
	t.Run("other library is 404", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-b1", alice)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})
	t.Run("own library art serves", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-b1", carol)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", rec.Code)
		}
	})
	t.Run("orphan art is 404 for scoped users only", func(t *testing.T) {
		// Unrestricted admins can fetch any stored blob (v1 parity);
		// scoped users get 404 because no reachable song references it.
		for _, tc := range []struct {
			cookie *http.Cookie
			want   int
		}{
			{admin, http.StatusOK},
			{alice, http.StatusNotFound},
			{carol, http.StatusNotFound},
		} {
			rec := s.do(t, http.MethodGet, "/api/cover-art/ca-orphan", tc.cookie)
			if rec.Code != tc.want {
				t.Errorf("want %d, got %d", tc.want, rec.Code)
			}
		}
	})
	t.Run("unknown id is 404", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/cover-art/nope", admin)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})
	t.Run("extension format maps to mime", func(t *testing.T) {
		s.mustExec(t, `UPDATE cover_arts SET format = 'jpg' WHERE id = 'ca-s1'`)
		rec := s.do(t, http.MethodGet, "/api/cover-art/ca-s1", alice)
		if ct := rec.Result().Header.Get("Content-Type"); ct != "image/jpeg" {
			t.Errorf("Content-Type: %q", ct)
		}
	})
}

// ---------------------------------------------------------------------------
// Malformed JSON columns (audit Q6): a bad column omits its field, never
// 500s the response.
// ---------------------------------------------------------------------------

func TestMalformedJSONColumns(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	admin := s.session(t, "user-admin", "root", true)

	s.mustExec(t, `UPDATE songs SET producers = '{broken', isrcs = '["ok"]' WHERE id = 's-a1'`)
	s.mustExec(t, `UPDATE albums SET catalog_numbers = 'not json', musicbrainz_album_artist_ids = '["mb-alpha"]' WHERE id = 'al-a1'`)
	s.mustExec(t, `UPDATE artists SET musicbrainz_artist_ids = 'oops', external_urls = '{"a":1}' WHERE id = 'ar-alpha'`)

	t.Run("songs list still 200", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/songs", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		body := decodeMap(t, rec)
		for _, item := range body["songs"].([]any) {
			song := item.(map[string]any)
			if song["id"] != "s-a1" {
				continue
			}
			if _, present := song["producers"]; present {
				t.Error("malformed producers must be omitted")
			}
			if got := song["isrcs"]; fmt.Sprint(got) != "[ok]" {
				t.Errorf("valid isrcs must survive: %v", got)
			}
		}
	})
	t.Run("song detail still 200", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/songs/s-a1", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if _, present := decodeMap(t, rec)["song"].(map[string]any)["producers"]; present {
			t.Error("malformed producers must be omitted")
		}
	})
	t.Run("albums list still 200", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums", admin)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		for _, item := range decodeMap(t, rec)["albums"].([]any) {
			album := item.(map[string]any)
			if album["id"] != "al-a1" {
				continue
			}
			if _, present := album["catalogNumbers"]; present {
				t.Error("malformed catalogNumbers must be omitted")
			}
			if got := album["musicBrainzAlbumArtistIds"]; fmt.Sprint(got) != "[mb-alpha]" {
				t.Errorf("valid musicBrainzAlbumArtistIds must survive: %v", got)
			}
		}
	})
	t.Run("artists list still 200", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/artists", admin)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		for _, item := range decodeMap(t, rec)["artists"].([]any) {
			artist := item.(map[string]any)
			if artist["id"] != "ar-alpha" {
				continue
			}
			if _, present := artist["musicBrainzArtistIds"]; present {
				t.Error("malformed musicBrainzArtistIds must be omitted")
			}
			if _, present := artist["externalUrls"]; !present {
				t.Error("valid externalUrls must survive")
			}
		}
	})
}

// ---------------------------------------------------------------------------
// DTO contract across every surface that embeds songs
// ---------------------------------------------------------------------------

func TestSongDTOContractEverywhere(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)

	assertNoBannedKeys := func(t *testing.T, song map[string]any) {
		t.Helper()
		for _, banned := range []string{"filePath", "checksum"} {
			if _, present := song[banned]; present {
				t.Errorf("song %s leaks %q", song["id"], banned)
			}
		}
	}

	t.Run("songs list", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/songs", alice)
		for _, item := range decodeMap(t, rec)["songs"].([]any) {
			assertNoBannedKeys(t, item.(map[string]any))
		}
	})
	t.Run("album detail songs", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums/al-a1", alice)
		for _, item := range decodeMap(t, rec)["songs"].([]any) {
			assertNoBannedKeys(t, item.(map[string]any))
		}
	})
	t.Run("artist detail and songs", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/artists/ar-alpha", alice)
		body := decodeMap(t, rec)
		for _, item := range body["songs"].([]any) {
			assertNoBannedKeys(t, item.(map[string]any))
		}
	})
}
