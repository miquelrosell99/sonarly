package playlists

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func entryIDs(d Detail) []string {
	ids := make([]string, len(d.Entries))
	for i, e := range d.Entries {
		ids[i] = e.ID
	}
	return ids
}

// TestListAccessAndTokenStripping: the list shows own + public +
// shared-with-me, and the share token appears only on the owner's rows.
func TestListAccessAndTokenStripping(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	viewer := env.cookie(t, "u-viewer", "viewer", false)

	res, body := env.do(t, "GET", "/api/playlists", owner, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner list: %d", res.StatusCode)
	}
	items := decodeList(t, body)
	byID := map[string]ListItem{}
	for _, it := range items {
		byID[it.ID] = it
	}
	for _, want := range []string{"pl-private", "pl-public", "pl-link", "pl-shared-v", "pl-shared-e", "pl-smart"} {
		if _, ok := byID[want]; !ok {
			t.Errorf("owner list missing %s", want)
		}
	}
	if _, ok := byID["pl-foreign"]; ok {
		t.Error("owner list must not include the outsider's private playlist")
	}
	// Token only on the owner's link playlists; nobody else's business.
	if byID["pl-link"].ShareToken != "tok-link" {
		t.Errorf("owner must see own shareToken, got %q", byID["pl-link"].ShareToken)
	}
	if byID["pl-smart"].ShareToken != "tok-smart" {
		t.Errorf("owner must see own smart shareToken, got %q", byID["pl-smart"].ShareToken)
	}
	// Smart playlists report the resolved count (title contains "a" → 2).
	if byID["pl-smart"].SongCount != 2 {
		t.Errorf("pl-smart count = %d, want 2", byID["pl-smart"].SongCount)
	}
	// Static playlists report the raw member count.
	if byID["pl-public"].SongCount != 2 {
		t.Errorf("pl-public count = %d, want 2", byID["pl-public"].SongCount)
	}

	res, body = env.do(t, "GET", "/api/playlists", viewer, nil)
	if res.StatusCode != 200 {
		t.Fatalf("viewer list: %d", res.StatusCode)
	}
	items = decodeList(t, body)
	byID = map[string]ListItem{}
	for _, it := range items {
		byID[it.ID] = it
	}
	for _, want := range []string{"pl-public", "pl-shared-v", "pl-shared-e"} {
		if _, ok := byID[want]; !ok {
			t.Errorf("viewer list missing %s", want)
		}
	}
	for _, hidden := range []string{"pl-private", "pl-link", "pl-smart", "pl-foreign"} {
		if _, ok := byID[hidden]; ok {
			t.Errorf("viewer list must not include %s", hidden)
		}
	}
	for _, it := range items {
		if it.ShareToken != "" {
			t.Errorf("share token leaked to non-owner in list: %s", it.ID)
		}
	}

	// Anonymous is rejected entirely.
	res, _ = env.do(t, "GET", "/api/playlists", nil, nil)
	if res.StatusCode != 401 {
		t.Errorf("anonymous list: want 401, got %d", res.StatusCode)
	}
}

// TestGetDetailAccess: view access via owner/share/public/link token; 404
// (never 403) when access is none; shareToken and shares are owner-only.
func TestGetDetailAccess(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	viewer := env.cookie(t, "u-viewer", "viewer", false)
	outsider := env.cookie(t, "u-outsider", "outsider", false)
	nolib := env.cookie(t, "u-nolib", "nolib", false)

	// Owner: token + shares visible.
	res, body := env.do(t, "GET", "/api/playlists/pl-shared-v", owner, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner detail: %d", res.StatusCode)
	}
	d := decodeDetail(t, body)
	if d.ShareToken != "" {
		t.Errorf("private playlist has no token, got %q", d.ShareToken)
	}
	if d.Shares == nil || len(*d.Shares) != 1 || (*d.Shares)[0].UserID != "u-viewer" || (*d.Shares)[0].CanEdit {
		t.Errorf("owner shares = %+v", d.Shares)
	}

	// v1 parity (P10): the owner's detail emits shares even when empty.
	res, body = env.do(t, "GET", "/api/playlists/pl-private", owner, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner detail of private playlist: %d", res.StatusCode)
	}
	var raw struct {
		Playlist struct {
			Shares *[]ShareEntry `json:"shares"`
		} `json:"playlist"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if raw.Playlist.Shares == nil || len(*raw.Playlist.Shares) != 0 {
		t.Errorf("owner with no shares must see shares: [], got %+v", raw.Playlist.Shares)
	}

	// Owner of the link playlist sees the token.
	_, body = env.do(t, "GET", "/api/playlists/pl-link", owner, nil)
	d = decodeDetail(t, body)
	if d.ShareToken != "tok-link" {
		t.Errorf("owner must see link token, got %q", d.ShareToken)
	}

	// Shared viewer: content yes, token/shares no.
	res, body = env.do(t, "GET", "/api/playlists/pl-shared-v", viewer, nil)
	if res.StatusCode != 200 {
		t.Fatalf("viewer detail: %d", res.StatusCode)
	}
	d = decodeDetail(t, body)
	if d.ShareToken != "" {
		t.Error("share token leaked to shared viewer (detail)")
	}
	if d.Shares != nil {
		t.Errorf("shares leaked to shared viewer: %+v", d.Shares)
	}
	if ids := entryIDs(d); strings.Join(ids, ",") != "s-a1" {
		t.Errorf("viewer entries = %v", ids)
	}

	// Public playlist, any signed-in user.
	res, _ = env.do(t, "GET", "/api/playlists/pl-public", outsider, nil)
	if res.StatusCode != 200 {
		t.Errorf("public detail by outsider: %d", res.StatusCode)
	}

	// Link playlist with the valid token, even for a user with no libraries.
	res, _ = env.do(t, "GET", "/api/playlists/pl-link?shareToken=tok-link", nolib, nil)
	if res.StatusCode != 200 {
		t.Errorf("link detail with valid token: %d", res.StatusCode)
	}
	// Wrong token → 404, not 403.
	res, _ = env.do(t, "GET", "/api/playlists/pl-link?shareToken=nope", nolib, nil)
	if res.StatusCode != 404 {
		t.Errorf("link detail with wrong token: want 404, got %d", res.StatusCode)
	}
	// Private playlist, stranger → 404.
	res, _ = env.do(t, "GET", "/api/playlists/pl-private", outsider, nil)
	if res.StatusCode != 404 {
		t.Errorf("private detail by outsider: want 404, got %d", res.StatusCode)
	}
	// Anonymous without a token → 401 (mirrors v1's session gate; only
	// shareToken requests are exempt).
	res, _ = env.do(t, "GET", "/api/playlists/pl-public", nil, nil)
	if res.StatusCode != 401 {
		t.Errorf("anonymous detail: want 401, got %d", res.StatusCode)
	}
	// Anonymous WITH the playlist's token → 200 (v1's public exemption).
	res, _ = env.do(t, "GET", "/api/playlists/pl-link?shareToken=tok-link", nil, nil)
	if res.StatusCode != 200 {
		t.Errorf("anonymous detail with share token: want 200, got %d", res.StatusCode)
	}
}

// TestCreateHappyPath: ordered members, counts, DTO shape.
func TestCreateHappyPath(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)

	res, body := env.do(t, "POST", "/api/playlists", owner, `{
		"name": "Roadtrip",
		"songIds": ["s-a2", "s-a1", "s-a2"]
	}`)
	if res.StatusCode != 201 {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	d := decodeDetail(t, body)
	if d.Name != "Roadtrip" || d.OwnerID != "u-owner" {
		t.Errorf("created = %+v", d)
	}
	if ids := entryIDs(d); strings.Join(ids, ",") != "s-a2,s-a1" {
		t.Errorf("entries = %v, want request order deduped", ids)
	}
	if d.SongCount != 2 {
		t.Errorf("songCount = %d, want 2", d.SongCount)
	}
	if len(d.Entries) != 2 || d.Entries[0].Type != "music" || d.Entries[0].IsDir {
		t.Errorf("entry shape = %+v", d.Entries)
	}
	e0 := d.Entries[0]
	if e0.Title != "Second Song" || e0.Album != "A1" || e0.Artist != "Alpha" || e0.Created == "" {
		t.Errorf("entry display fields = %+v", e0)
	}
	if len(e0.Artists) != 1 || e0.Artists[0] != "Alpha" {
		t.Errorf("entry artists = %v", e0.Artists)
	}
}

// TestCreateValidation: name required; invalid song ids → 400 listing them
// and NOTHING inserted (one transaction).
func TestCreateValidation(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)

	res, _ := env.do(t, "POST", "/api/playlists", owner, `{"name": ""}`)
	if res.StatusCode != 400 {
		t.Errorf("empty name: want 400, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "POST", "/api/playlists", owner, `{"name": "   "}`)
	if res.StatusCode != 400 {
		t.Errorf("blank name: want 400, got %d", res.StatusCode)
	}

	res, body := env.do(t, "POST", "/api/playlists", owner,
		`{"name": "Broken", "songIds": ["s-a1", "nope-1", "nope-2"]}`)
	if res.StatusCode != 400 {
		t.Fatalf("invalid ids: want 400, got %d", res.StatusCode)
	}
	if !strings.Contains(string(body), "nope-1") || !strings.Contains(string(body), "nope-2") {
		t.Errorf("400 must list the invalid ids: %s", body)
	}
	// Nothing inserted.
	res, listBody := env.do(t, "GET", "/api/playlists", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	for _, it := range decodeList(t, listBody) {
		if it.Name == "Broken" {
			t.Error("failed create must not leave a playlist row behind")
		}
	}
	// Out-of-scope ids are invalid for the caller too.
	res, _ = env.do(t, "POST", "/api/playlists", owner, `{"name": "X", "songIds": ["s-b1"]}`)
	if res.StatusCode != 400 {
		t.Errorf("out-of-scope id: want 400, got %d", res.StatusCode)
	}
	// Inactive ids too.
	res, _ = env.do(t, "POST", "/api/playlists", owner, `{"name": "X", "songIds": ["s-inactive"]}`)
	if res.StatusCode != 400 {
		t.Errorf("inactive id: want 400, got %d", res.StatusCode)
	}
}

// TestCreateSmart: rules presence makes the playlist smart; bogus rules
// are 400s, valid rules resolve at read time.
func TestCreateSmart(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)

	res, body := env.do(t, "POST", "/api/playlists", owner, `{
		"name": "SmartNew",
		"rules": {"rules": {"all": [{"field": "genre", "operator": "is", "value": "Jazz"}]},
		          "sort": [{"field": "title", "direction": "asc"}]}
	}`)
	if res.StatusCode != 201 {
		t.Fatalf("smart create: %d %s", res.StatusCode, body)
	}
	d := decodeDetail(t, body)
	if !d.IsSmart {
		t.Error("rules must create a smart playlist")
	}
	if ids := entryIDs(d); strings.Join(ids, ",") != "s-a1,s-b2" {
		t.Errorf("smart entries = %v, want junction-matched sorted [s-a1 s-b2]", ids)
	}

	res, _ = env.do(t, "POST", "/api/playlists", owner,
		`{"name": "BadRules", "rules": {"rules": {"all": [{"field": "bogus", "operator": "is", "value": "x"}]}}}`)
	if res.StatusCode != 400 {
		t.Errorf("bogus rule field: want 400, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "POST", "/api/playlists", owner, `{"name": "BadVis", "visibility": "nope"}`)
	if res.StatusCode != 400 {
		t.Errorf("bogus visibility: want 400, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "POST", "/api/playlists", owner,
		`{"name": "BadMode", "rules": {"rules": {"all": [{"field": "title", "operator": "is", "value": "x"}]}}, "resolveMode": "later"}`)
	if res.StatusCode != 400 {
		t.Errorf("bogus resolveMode: want 400, got %d", res.StatusCode)
	}
}

// TestCreateWithLinkVisibility mints a token at create time.
func TestCreateWithLinkVisibility(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	res, body := env.do(t, "POST", "/api/playlists", owner,
		`{"name": "Linked", "visibility": "link", "songIds": ["s-a1"]}`)
	if res.StatusCode != 201 {
		t.Fatalf("create link: %d", res.StatusCode)
	}
	d := decodeDetail(t, body)
	if d.Visibility != "link" || d.ShareToken == "" {
		t.Errorf("link create = %s %q", d.Visibility, d.ShareToken)
	}
	if len(d.ShareToken) != 64 {
		t.Errorf("token must be 64 hex chars, got %d", len(d.ShareToken))
	}
}

// TestUpdateRewrite: rename + member rewrite in one tx; smart playlists
// reject manual song edits.
func TestUpdateRewrite(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)

	res, body := env.do(t, "PUT", "/api/playlists/pl-private", owner,
		`{"name": "Renamed", "songIds": ["s-a2"]}`)
	if res.StatusCode != 200 {
		t.Fatalf("update: %d %s", res.StatusCode, body)
	}
	d := decodeDetail(t, body)
	if d.Name != "Renamed" {
		t.Errorf("name = %q", d.Name)
	}
	if ids := entryIDs(d); strings.Join(ids, ",") != "s-a2" {
		t.Errorf("entries = %v", ids)
	}

	// Smart playlists reject manual member edits.
	res, _ = env.do(t, "PUT", "/api/playlists/pl-smart", owner, `{"songIds": ["s-a1"]}`)
	if res.StatusCode != 400 {
		t.Errorf("smart member edit: want 400, got %d", res.StatusCode)
	}
	// ...but accept rule edits.
	res, body = env.do(t, "PUT", "/api/playlists/pl-smart", owner,
		`{"rules": {"rules": {"all": [{"field": "genre", "operator": "is", "value": "Rock"}]}}}`)
	if res.StatusCode != 200 {
		t.Fatalf("smart rules edit: %d", res.StatusCode)
	}
	d = decodeDetail(t, body)
	if ids := entryIDs(d); strings.Join(ids, ",") != "s-a1,s-a2" {
		t.Errorf("re-resolved entries = %v", ids)
	}
}

// TestUpdateVisibilityTokenLifecycle: v1 native PUT semantics (P10
// decision) — visibility changes NEVER clear the token; visibility='link'
// auto-mints a token only when none is set.
func TestUpdateVisibilityTokenLifecycle(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)

	// private → link mints.
	res, body := env.do(t, "PUT", "/api/playlists/pl-private", owner, `{"visibility": "link"}`)
	if res.StatusCode != 200 {
		t.Fatalf("update to link: %d", res.StatusCode)
	}
	d := decodeDetail(t, body)
	if d.Visibility != "link" || len(d.ShareToken) != 64 {
		t.Errorf("auto-mint: %s %q", d.Visibility, d.ShareToken)
	}
	token := d.ShareToken

	// Another PUT to link keeps the same token (no surprise rotation).
	res, body = env.do(t, "PUT", "/api/playlists/pl-private", owner, `{"visibility": "link"}`)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if d := decodeDetail(t, body); d.ShareToken != token {
		t.Errorf("token rotated on no-op visibility PUT: %q → %q", token, d.ShareToken)
	}

	// link → public KEEPS the token (v1 management-routes: visibility
	// changes never touch the share token).
	res, body = env.do(t, "PUT", "/api/playlists/pl-private", owner, `{"visibility": "public"}`)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if d := decodeDetail(t, body); d.ShareToken != token {
		t.Errorf("native PUT revoked the token, want it kept: %q", d.ShareToken)
	}

	// public → private also keeps the token.
	res, body = env.do(t, "PUT", "/api/playlists/pl-private", owner, `{"visibility": "private"}`)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if d := decodeDetail(t, body); d.ShareToken != token {
		t.Errorf("native visibility PUT cleared the token, want %q kept", token)
	}

	// private → link with an existing token does NOT rotate it.
	res, body = env.do(t, "PUT", "/api/playlists/pl-private", owner, `{"visibility": "link"}`)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if d := decodeDetail(t, body); d.ShareToken != token {
		t.Errorf("re-entering link rotated the token: %q → %q", token, d.ShareToken)
	}
}

// TestUpdateAccessLevels: edit shares can update; view shares get 403;
// strangers get 404.
func TestUpdateAccessLevels(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	viewer := env.cookie(t, "u-viewer", "viewer", false)
	outsider := env.cookie(t, "u-outsider", "outsider", false)

	res, _ := env.do(t, "PUT", "/api/playlists/pl-shared-e", viewer, `{"name": "EditorEdit"}`)
	if res.StatusCode != 200 {
		t.Errorf("edit share must update: %d", res.StatusCode)
	}
	res, _ = env.do(t, "PUT", "/api/playlists/pl-shared-v", viewer, `{"name": "Nope"}`)
	if res.StatusCode != 403 {
		t.Errorf("view share update: want 403, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "PUT", "/api/playlists/pl-shared-e", outsider, `{"name": "Nope"}`)
	if res.StatusCode != 404 {
		t.Errorf("stranger update: want 404, got %d", res.StatusCode)
	}
	// The view-share rename must not have landed.
	res, body := env.do(t, "GET", "/api/playlists/pl-shared-v", owner, nil)
	if res.StatusCode == 200 {
		if d := decodeDetail(t, body); d.Name == "Nope" {
			t.Error("forbidden update landed")
		}
	}
}

// TestDeleteAccessLevels: owner deletes; everyone else is 403/404.
func TestDeleteAccessLevels(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	viewer := env.cookie(t, "u-viewer", "viewer", false)
	outsider := env.cookie(t, "u-outsider", "outsider", false)

	res, _ := env.do(t, "DELETE", "/api/playlists/pl-shared-e", viewer, nil)
	if res.StatusCode != 403 {
		t.Errorf("edit share delete: want 403, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "DELETE", "/api/playlists/pl-private", outsider, nil)
	if res.StatusCode != 404 {
		t.Errorf("stranger delete: want 404, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "DELETE", "/api/playlists/pl-private", owner, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner delete: %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/playlists/pl-private", owner, nil)
	if res.StatusCode != 404 {
		t.Errorf("deleted playlist: want 404, got %d", res.StatusCode)
	}
}

// TestShareGrantRevoke: owner grants view access; revoke removes it;
// non-owners cannot manage shares.
func TestShareGrantRevoke(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	outsider := env.cookie(t, "u-outsider", "outsider", false)

	res, _ := env.do(t, "POST", "/api/playlists/pl-private/share", owner,
		`{"userId": "u-outsider", "canEdit": false}`)
	if res.StatusCode != 200 {
		t.Fatalf("grant: %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/playlists/pl-private", outsider, nil)
	if res.StatusCode != 200 {
		t.Errorf("granted viewer: want 200, got %d", res.StatusCode)
	}

	// Non-owner cannot grant (edit share included).
	viewer := env.cookie(t, "u-viewer", "viewer", false)
	res, _ = env.do(t, "POST", "/api/playlists/pl-shared-e/share", viewer,
		`{"userId": "u-nolib"}`)
	if res.StatusCode != 403 {
		t.Errorf("non-owner grant: want 403, got %d", res.StatusCode)
	}
	// Unknown target user → 400.
	res, _ = env.do(t, "POST", "/api/playlists/pl-private/share", owner,
		`{"userId": "u-ghost"}`)
	if res.StatusCode != 400 {
		t.Errorf("unknown user grant: want 400, got %d", res.StatusCode)
	}

	res, _ = env.do(t, "DELETE", "/api/playlists/pl-private/share/u-outsider", owner, nil)
	if res.StatusCode != 200 {
		t.Fatalf("revoke: %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/playlists/pl-private", outsider, nil)
	if res.StatusCode != 404 {
		t.Errorf("revoked viewer: want 404, got %d", res.StatusCode)
	}
}

// TestShareLinkEndpoints: v1 semantics (P10 decision) — create mints a
// token WITHOUT touching visibility; regenerate kills the old token;
// delete clears the token only. The native anonymous metadata view grants
// access on a matching token regardless of visibility (v1 canViewPlaylist).
func TestShareLinkEndpoints(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)
	nolib := env.cookie(t, "u-nolib", "nolib", false)
	viewer := env.cookie(t, "u-viewer", "viewer", false)

	res, body := env.do(t, "POST", "/api/playlists/pl-private/share-link", owner, nil)
	if res.StatusCode != 200 {
		t.Fatalf("share-link: %d", res.StatusCode)
	}
	var tok struct {
		ShareToken string `json:"shareToken"`
	}
	decodeBody(t, body, &tok)
	if len(tok.ShareToken) != 64 {
		t.Fatalf("token = %q", tok.ShareToken)
	}
	// Visibility is NOT pinned to link; the detail shows the token to the owner.
	res, body = env.do(t, "GET", "/api/playlists/pl-private", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	detail := decodeDetail(t, body)
	if detail.Visibility != "private" || detail.ShareToken != tok.ShareToken {
		t.Errorf("after share-link: %s %q, want private with the token", detail.Visibility, detail.ShareToken)
	}
	// The token authorizes a no-library user even though visibility stayed
	// private (v1 canViewPlaylist — the documented native divergence).
	res, _ = env.do(t, "GET", fmt.Sprintf("/api/playlists/pl-private?shareToken=%s", tok.ShareToken), nolib, nil)
	if res.StatusCode != 200 {
		t.Errorf("token detail: want 200, got %d", res.StatusCode)
	}
	// No token → 404; wrong token → 404.
	res, _ = env.do(t, "GET", "/api/playlists/pl-private", nil, nil)
	if res.StatusCode != 401 {
		t.Errorf("anonymous without token: want 401, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", fmt.Sprintf("/api/playlists/pl-private?shareToken=%s", tok.ShareToken)+"x", nil, nil)
	if res.StatusCode != 404 {
		t.Errorf("wrong token: want 404, got %d", res.StatusCode)
	}

	// Regenerate: old token dies, new token works.
	res, body = env.do(t, "POST", "/api/playlists/pl-private/share-link", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	var tok2 struct {
		ShareToken string `json:"shareToken"`
	}
	decodeBody(t, body, &tok2)
	if tok2.ShareToken == tok.ShareToken {
		t.Fatal("regenerate must mint a fresh token")
	}
	res, _ = env.do(t, "GET", fmt.Sprintf("/api/playlists/pl-private?shareToken=%s", tok.ShareToken), nolib, nil)
	if res.StatusCode != 404 {
		t.Errorf("old token after regenerate: want 404, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", fmt.Sprintf("/api/playlists/pl-private?shareToken=%s", tok2.ShareToken), nolib, nil)
	if res.StatusCode != 200 {
		t.Errorf("new token: want 200, got %d", res.StatusCode)
	}

	// Non-owner cannot manage the link.
	res, _ = env.do(t, "POST", "/api/playlists/pl-shared-v/share-link", viewer, nil)
	if res.StatusCode != 403 {
		t.Errorf("non-owner share-link: want 403, got %d", res.StatusCode)
	}

	// Delete: token cleared, visibility left exactly as it was (private).
	res, _ = env.do(t, "DELETE", "/api/playlists/pl-private/share-link", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	res, body = env.do(t, "GET", "/api/playlists/pl-private", owner, nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	detail = decodeDetail(t, body)
	if detail.Visibility != "private" || detail.ShareToken != "" {
		t.Errorf("after delete share-link: %s %q, want private with no token", detail.Visibility, detail.ShareToken)
	}
	res, _ = env.do(t, "GET", fmt.Sprintf("/api/playlists/pl-private?shareToken=%s", tok2.ShareToken), nolib, nil)
	if res.StatusCode != 404 {
		t.Errorf("revoked token: want 404, got %d", res.StatusCode)
	}
}

// TestSmartStaticConversion: static→smart materialization/drop and
// smart→static materialization.
func TestSmartStaticConversion(t *testing.T) {
	env := newEnv(t)
	owner := env.cookie(t, "u-owner", "owner", false)

	// Static → smart: members dropped, rules take over.
	res, body := env.do(t, "PUT", "/api/playlists/pl-private", owner,
		`{"isSmart": true, "rules": {"rules": {"all": [{"field": "genre", "operator": "is", "value": "Pop"}]}}}`)
	if res.StatusCode != 200 {
		t.Fatalf("convert to smart: %d %s", res.StatusCode, body)
	}
	d := decodeDetail(t, body)
	if !d.IsSmart || len(d.Entries) != 1 || d.Entries[0].ID != "s-b1" {
		t.Errorf("smart conversion = %+v", d)
	}

	// Smart → static: materializes the current resolution.
	res, body = env.do(t, "PUT", "/api/playlists/pl-private", owner, `{"isSmart": false}`)
	if res.StatusCode != 200 {
		t.Fatalf("convert to static: %d %s", res.StatusCode, body)
	}
	d = decodeDetail(t, body)
	if d.IsSmart || len(d.Entries) != 1 || d.Entries[0].ID != "s-b1" {
		t.Errorf("static conversion = %+v", d)
	}

	// Converting to smart without rules → 400.
	res, _ = env.do(t, "PUT", "/api/playlists/pl-public", owner, `{"isSmart": true}`)
	if res.StatusCode != 400 {
		t.Errorf("smart without rules: want 400, got %d", res.StatusCode)
	}
}

func decodeBody(t *testing.T, body []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(body, v); err != nil {
		t.Fatalf("decode: %v\n%s", err, body)
	}
}
