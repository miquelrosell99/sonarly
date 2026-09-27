package playlists

import (
	"fmt"
	"testing"
)

// TestShareLinkDownloadFlagRoundTrip: POST /share-link accepts allowDownload
// (default false) and returns the flag; PATCH updates it WITHOUT rotating
// the token; the owner detail round-trips the flag.
func TestShareLinkDownloadFlagRoundTrip(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)

	// Create with the flag on.
	res, body := env.do(t, "POST", "/api/playlists/pl-private/share-link", owner, `{"allowDownload": true}`)
	if res.StatusCode != 200 {
		t.Fatalf("share-link allowDownload: %d", res.StatusCode)
	}
	var created struct {
		ShareToken    string `json:"shareToken"`
		ShareDownload bool   `json:"shareDownload"`
	}
	decodeBody(t, body, &created)
	if len(created.ShareToken) != 64 {
		t.Fatalf("token = %q", created.ShareToken)
	}
	if !created.ShareDownload {
		t.Fatal("created share-link must return shareDownload=true")
	}

	// Owner detail carries the flag.
	res, body = env.do(t, "GET", "/api/playlists/pl-private", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	detail := decodeDetail(t, body)
	if !detail.ShareDownload {
		t.Fatal("owner detail must expose shareDownload=true")
	}

	// PATCH off: flag flips, token survives.
	res, body = env.do(t, "PATCH", "/api/playlists/pl-private/share-link", owner, `{"allowDownload": false}`)
	if res.StatusCode != 200 {
		t.Fatalf("patch share-link: %d", res.StatusCode)
	}
	var patched struct {
		ShareDownload bool `json:"shareDownload"`
	}
	decodeBody(t, body, &patched)
	if patched.ShareDownload {
		t.Fatal("patched response must return shareDownload=false")
	}
	res, body = env.do(t, "GET", "/api/playlists/pl-private", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	detail = decodeDetail(t, body)
	if detail.ShareDownload {
		t.Fatal("detail must show shareDownload=false after PATCH")
	}
	if detail.ShareToken != created.ShareToken {
		t.Fatal("PATCH must not rotate the token")
	}

	// PATCH back on.
	res, body = env.do(t, "PATCH", "/api/playlists/pl-private/share-link", owner, `{"allowDownload": true}`)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	decodeBody(t, body, &patched)
	if !patched.ShareDownload {
		t.Fatal("PATCH back on must return shareDownload=true")
	}
	res, body = env.do(t, "GET", fmt.Sprintf("/api/playlists/pl-private?shareToken=%s", created.ShareToken),
		env.cookie(t, "u-nolib", "nolib", false), nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if d := decodeDetail(t, body); !d.ShareDownload {
		t.Fatal("token-resolved viewer must see shareDownload=true")
	}
}

// TestShareLinkDownloadFlagDefaultsOff: a body-less POST (the pre-2.2 client
// shape) keeps links stream-only.
func TestShareLinkDownloadFlagDefaultsOff(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)

	res, body := env.do(t, "POST", "/api/playlists/pl-public/share-link", owner, nil)
	if res.StatusCode != 200 {
		t.Fatalf("body-less share-link: %d", res.StatusCode)
	}
	var created struct {
		ShareToken    string `json:"shareToken"`
		ShareDownload bool   `json:"shareDownload"`
	}
	decodeBody(t, body, &created)
	if created.ShareDownload {
		t.Fatal("omitted allowDownload must default to false")
	}
	// An empty object means the same.
	res, body = env.do(t, "POST", "/api/playlists/pl-public/share-link", owner, `{}`)
	if res.StatusCode != 200 {
		t.Fatalf("empty-object share-link: %d", res.StatusCode)
	}
	decodeBody(t, body, &created)
	if created.ShareDownload {
		t.Fatal("empty allowDownload must default to false")
	}
}

// TestShareLinkPatchAuthz: only the owner manages the flag; inaccessible
// playlists answer 404 (never 403) so ids cannot be probed.
func TestShareLinkPatchAuthz(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	viewer := env.cookie(t, "u-viewer", "viewer", false)
	outsider := env.cookie(t, "u-outsider", "outsider", false)

	res, _ := env.do(t, "PATCH", "/api/playlists/pl-shared-v/share-link", viewer, `{"allowDownload": true}`)
	if res.StatusCode != 403 {
		t.Errorf("viewer patch: want 403, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "PATCH", "/api/playlists/pl-foreign/share-link", owner, `{"allowDownload": true}`)
	if res.StatusCode != 404 {
		t.Errorf("foreign playlist patch: want 404, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "PATCH", "/api/playlists/pl-private/share-link", outsider, `{"allowDownload": true}`)
	if res.StatusCode != 404 {
		t.Errorf("outsider patch: want 404, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "PATCH", "/api/playlists/pl-private/share-link", nil, `{"allowDownload": true}`)
	if res.StatusCode != 401 {
		t.Errorf("anonymous patch: want 401, got %d", res.StatusCode)
	}
	// Garbage body.
	res, _ = env.do(t, "PATCH", "/api/playlists/pl-private/share-link", owner, `{"allowDownload":`)
	if res.StatusCode != 400 {
		t.Errorf("garbage body patch: want 400, got %d", res.StatusCode)
	}
	// The flag must be untouched by all of the above.
	res, body := env.do(t, "GET", "/api/playlists/pl-private", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if decodeDetail(t, body).ShareDownload {
		t.Fatal("unauthorized patches must not flip the flag")
	}
}

// TestDetailShareDownloadExposure: the flag rides the detail ONLY for the
// owner and token-resolved viewers; other session viewers see false.
func TestDetailShareDownloadExposure(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	viewer := env.cookie(t, "u-viewer", "viewer", false)

	res, body := env.do(t, "POST", "/api/playlists/pl-link/share-link", owner, `{"allowDownload": true}`)
	if res.StatusCode != 200 {
		t.Fatalf("share-link: %d", res.StatusCode)
	}
	var created struct {
		ShareToken string `json:"shareToken"`
	}
	decodeBody(t, body, &created)

	// Token-resolved anonymous viewer sees the real flag.
	res, body = env.do(t, "GET", fmt.Sprintf("/api/playlists/pl-link?shareToken=%s", created.ShareToken), nil, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if d := decodeDetail(t, body); !d.ShareDownload {
		t.Fatal("token viewer must see shareDownload=true")
	}

	// Session viewer WITHOUT the token: private playlist → 404 anyway; use a
	// plain viewer of a public playlist instead (below). Here the owner sees it.
	res, body = env.do(t, "GET", "/api/playlists/pl-link", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if d := decodeDetail(t, body); !d.ShareDownload {
		t.Fatal("owner must see shareDownload=true")
	}

	// Public playlist, flag on, no token in the request: the session viewer
	// gets the detail but the flag stays hidden (false).
	res, body = env.do(t, "POST", "/api/playlists/pl-public/share-link", owner, `{"allowDownload": true}`)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	res, body = env.do(t, "GET", "/api/playlists/pl-public", viewer, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if d := decodeDetail(t, body); d.ShareDownload {
		t.Fatal("plain session viewer must not see the stored flag")
	}
}
