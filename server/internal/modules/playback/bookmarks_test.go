package playback

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

type bookmarkListResponse struct {
	Bookmarks []struct {
		SongID    string  `json:"songId"`
		Position  int     `json:"position"`
		Comment   *string `json:"comment"`
		CreatedAt string  `json:"createdAt"`
		UpdatedAt string  `json:"updatedAt"`
		Song      struct {
			ID         string `json:"id"`
			Title      string `json:"title"`
			Duration   int    `json:"duration"`
			ArtistName string `json:"artistName"`
			AlbumName  string `json:"albumName"`
		} `json:"song"`
	} `json:"bookmarks"`
}

func listBookmarks(t *testing.T, env *testEnv, cookie *http.Cookie) bookmarkListResponse {
	t.Helper()
	res, body := env.do(t, "GET", "/api/bookmarks", cookie, nil)
	if res.StatusCode != 200 {
		t.Fatalf("GET /api/bookmarks: status %d", res.StatusCode)
	}
	var out bookmarkListResponse
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode bookmarks: %v (%s)", err, body)
	}
	return out
}

func putBookmark(t *testing.T, env *testEnv, songID string, cookie *http.Cookie, body string) *http.Response {
	t.Helper()
	res, _ := env.do(t, "PUT", "/api/songs/"+songID+"/bookmark", cookie, body)
	return res
}

// TestBookmarkRoundTrip: put → get → upsert → get → delete → get.
func TestBookmarkRoundTrip(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	res := putBookmark(t, env, "s-a1", alice, `{"position":42,"comment":"mid-solo"}`)
	if res.StatusCode != 200 {
		t.Fatalf("PUT: status %d", res.StatusCode)
	}

	bookmarks := listBookmarks(t, env, alice)
	if len(bookmarks.Bookmarks) != 1 {
		t.Fatalf("bookmarks = %d, want 1", len(bookmarks.Bookmarks))
	}
	b := bookmarks.Bookmarks[0]
	if b.SongID != "s-a1" || b.Position != 42 || b.Comment == nil || *b.Comment != "mid-solo" {
		t.Errorf("bookmark = %+v", b)
	}
	if b.CreatedAt == "" || b.UpdatedAt == "" {
		t.Errorf("timestamps missing: %+v", b)
	}
	if b.Song.ID != "s-a1" || b.Song.Title != "One" || b.Song.Duration != 3 ||
		b.Song.ArtistName != "Alpha" || b.Song.AlbumName != "A1" {
		t.Errorf("joined song info wrong: %+v", b.Song)
	}

	// Upsert: same PK, new values; comment may be nulled out.
	res = putBookmark(t, env, "s-a1", alice, `{"position":99}`)
	if res.StatusCode != 200 {
		t.Fatalf("PUT upsert: status %d", res.StatusCode)
	}
	bookmarks = listBookmarks(t, env, alice)
	if len(bookmarks.Bookmarks) != 1 || bookmarks.Bookmarks[0].Position != 99 {
		t.Fatalf("upsert did not replace: %+v", bookmarks.Bookmarks)
	}
	if bookmarks.Bookmarks[0].Comment != nil {
		t.Errorf("omitted comment must clear the column, got %q", *bookmarks.Bookmarks[0].Comment)
	}

	// A second song joins the list.
	if res := putBookmark(t, env, "s-a2", alice, `{"position":7}`); res.StatusCode != 200 {
		t.Fatalf("PUT s-a2: status %d", res.StatusCode)
	}
	bookmarks = listBookmarks(t, env, alice)
	if len(bookmarks.Bookmarks) != 2 {
		t.Fatalf("bookmarks = %d, want 2", len(bookmarks.Bookmarks))
	}

	// Delete; deleting again is a wire-parity no-op success.
	if res, _ := env.do(t, "DELETE", "/api/songs/s-a1/bookmark", alice, nil); res.StatusCode != 200 {
		t.Fatalf("DELETE: status %d", res.StatusCode)
	}
	if res, _ := env.do(t, "DELETE", "/api/songs/s-a1/bookmark", alice, nil); res.StatusCode != 200 {
		t.Errorf("DELETE of missing bookmark: status %d, want 200 (old no-op)", res.StatusCode)
	}
	bookmarks = listBookmarks(t, env, alice)
	if len(bookmarks.Bookmarks) != 1 || bookmarks.Bookmarks[0].SongID != "s-a2" {
		t.Errorf("after delete: %+v", bookmarks.Bookmarks)
	}
}

// TestBookmarkScopedVisibility: bookmarks are the caller's own, and songs
// outside the caller's scope never surface — not even as holes.
func TestBookmarkScopedVisibility(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)
	carol := env.cookie(t, "user-carol", "carol", false)

	// carol bookmarks her lib-b song; alice must not see it...
	if res := putBookmark(t, env, "s-b1", carol, `{"position":3}`); res.StatusCode != 200 {
		t.Fatalf("carol PUT: status %d", res.StatusCode)
	}
	if got := listBookmarks(t, env, alice); len(got.Bookmarks) != 0 {
		t.Errorf("alice sees %d bookmarks, want 0", len(got.Bookmarks))
	}
	// ...and alice cannot bookmark it either (404, unprobeable).
	if res := putBookmark(t, env, "s-b1", alice, `{"position":3}`); res.StatusCode != 404 {
		t.Errorf("alice PUT foreign song: status %d, want 404", res.StatusCode)
	}
	if res, _ := env.do(t, "DELETE", "/api/songs/s-b1/bookmark", alice, nil); res.StatusCode != 404 {
		t.Errorf("alice DELETE foreign song: status %d, want 404", res.StatusCode)
	}

	// carol sees her own, with her joined song info.
	got := listBookmarks(t, env, carol)
	if len(got.Bookmarks) != 1 || got.Bookmarks[0].Song.Title != "Beta One" {
		t.Errorf("carol bookmarks: %+v", got.Bookmarks)
	}

	// Bookmarks of songs the library later deactivates drop out of the list.
	env.mustExec(t, `UPDATE songs SET active = 0 WHERE id = 's-b1'`)
	if got := listBookmarks(t, env, carol); len(got.Bookmarks) != 0 {
		t.Errorf("deactivated song still listed: %+v", got.Bookmarks)
	}
}

// TestBookmarkGuardsAndValidation: auth plus the PUT body contract.
func TestBookmarkGuardsAndValidation(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	if res, _ := env.do(t, "GET", "/api/bookmarks", nil, nil); res.StatusCode != 401 {
		t.Errorf("anon GET: status %d, want 401", res.StatusCode)
	}
	if res := putBookmark(t, env, "s-a1", nil, `{"position":1}`); res.StatusCode != 401 {
		t.Errorf("anon PUT: status %d, want 401", res.StatusCode)
	}

	cases := []struct {
		name string
		body string
		want int
	}{
		{"empty object", `{}`, 400},
		{"negative position", `{"position":-1}`, 400},
		{"fractional position", `{"position":3.5}`, 400},
		{"string position", `{"position":"3"}`, 400},
		{"comment wrong type", `{"position":1,"comment":7}`, 400},
		{"comment at the bound", fmt.Sprintf(`{"position":1,"comment":%q}`, strings.Repeat("c", maxBookmarkCommentLen)), 200},
		{"comment over the bound", fmt.Sprintf(`{"position":1,"comment":%q}`, strings.Repeat("c", maxBookmarkCommentLen+1)), 400},
		{"inactive song", `{"position":1}`, 404},
		{"unknown song", `{"position":1}`, 404},
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			songID := "s-a1"
			if i >= len(cases)-2 {
				songID = map[int]string{len(cases) - 2: "s-inactive", len(cases) - 1: "nope"}[i]
			}
			res := putBookmark(t, env, songID, alice, c.body)
			if res.StatusCode != c.want {
				t.Errorf("want %d, got %d", c.want, res.StatusCode)
			}
		})
	}
	// The two 200-submissions landed (valid + at-bound comment overwrite).
	bookmarks := listBookmarks(t, env, alice)
	if len(bookmarks.Bookmarks) != 1 {
		t.Errorf("bookmarks = %d, want 1", len(bookmarks.Bookmarks))
	}
}
