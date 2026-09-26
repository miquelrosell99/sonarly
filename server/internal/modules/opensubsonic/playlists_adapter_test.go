package opensubsonic

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/playlists"
)

// setupPlaylistWorld: alice (lib-a scope), root admin, bob (no scope
// assignments), and playlists covering every visibility class.
func setupPlaylistWorld(t *testing.T, app *testApp) (catalogIDs, map[string]string) {
	t.Helper()
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedUser(t, "user-bob", "bob", "bobpass", false)
	c := app.seedCatalog(t, "")
	ctx := context.Background()

	ids := map[string]string{}
	create := func(key, name, owner string, visibility string, songIDs []string) {
		t.Helper()
		detail, err := app.playlists.Create(ctx, identityFor(owner), playlists.Input{
			Name: name, Visibility: visibility, SongIDs: songIDs,
		})
		if err != nil {
			t.Fatalf("seed playlist %s: %v", name, err)
		}
		ids[key] = detail.ID
	}

	// Alice's private playlist, lib-a songs only (her scope).
	create("alice-private", "Alice Mix", testUserID, "private", []string{c.SAbbey1, c.SAbbey2})
	// Admin's playlists: public (lib-a songs so alice sees them whole),
	// private, and one shared with alice view-only.
	create("admin-public", "Root Public", c.Admin, "public", []string{c.SAbbey1})
	create("admin-private", "Root Secret", c.Admin, "private", []string{c.SLow1})
	create("admin-shared", "Root Shared", c.Admin, "private", []string{c.SAbbey2})
	share := func(playlistID, userID string, canEdit bool) {
		t.Helper()
		if err := app.playlists.Share(ctx, identityFor(c.Admin), playlistID, userID, canEdit); err != nil {
			t.Fatalf("seed share: %v", err)
		}
	}
	share(ids["admin-shared"], testUserID, false)
	share(ids["admin-private"], "user-bob", true) // bob can EDIT Root Secret
	return c, ids
}

// identityFor builds an auth identity for a seeded user.
func identityFor(userID string) auth.Identity {
	switch userID {
	case testUserID:
		return auth.Identity{UserID: testUserID, Username: testUser}
	case "user-bob":
		return auth.Identity{UserID: "user-bob", Username: "bob"}
	default:
		return auth.Identity{UserID: userID, Username: "root", IsAdmin: true}
	}
}

func TestGetPlaylistsScopeAndWireShape(t *testing.T) {
	app := newTestApp(t)
	c, ids := setupPlaylistWorld(t, app)

	rec := app.get(t, authedURL("/rest/getPlaylists.view", ""), nil)
	env := assertOK(t, rec)
	list, ok := env["playlists"].(map[string]any)["playlist"].([]any)
	if !ok {
		t.Fatalf("missing playlists.playlist: %v", env)
	}
	got := map[string]map[string]any{}
	for _, raw := range list {
		p := raw.(map[string]any)
		got[p["name"].(string)] = p
	}
	for _, want := range []string{"Alice Mix", "Root Public", "Root Shared"} {
		if _, ok := got[want]; !ok {
			t.Fatalf("getPlaylists missing %q: %v", want, got)
		}
	}
	if _, ok := got["Root Secret"]; ok {
		t.Fatalf("alice must not see the admin's private playlist: %v", got)
	}
	_ = ids
	_ = c

	// the retired server wire shape: owner, public, songCount, duration, ISO created.
	mix := got["Alice Mix"]
	if mix["id"] != ids["alice-private"] {
		t.Fatalf("id = %v", mix["id"])
	}
	if mix["owner"] != testUser {
		t.Fatalf("owner = %v", mix["owner"])
	}
	if mix["public"] != false {
		t.Fatalf("private playlist public = %v", mix["public"])
	}
	if mix["songCount"] != float64(2) {
		t.Fatalf("songCount = %v", mix["songCount"])
	}
	// 259 + 182 seconds, unrounded on the list view.
	if mix["duration"] != float64(441) {
		t.Fatalf("duration = %v", mix["duration"])
	}
	created, ok := mix["created"].(string)
	if !ok || !strings.Contains(created, "T") {
		t.Fatalf("created must be ISO-8601: %v", mix["created"])
	}
	if mix["changed"] == nil {
		t.Fatalf("changed missing: %v", mix)
	}
	// List view carries no entries.
	if _, hasEntries := mix["entry"]; hasEntries {
		t.Fatalf("getPlaylists must not include entries: %v", mix)
	}

	// The admin sees every playlist they own (3) — alice's private one
	// stays hidden: admins are not owners and the visibility set is the
	// same the retired server query (owner + public + shared).
	rec = app.get(t, authedURLAs("root", "adminpass", "/rest/getPlaylists.view", ""), nil)
	env = assertOK(t, rec)
	list = env["playlists"].(map[string]any)["playlist"].([]any)
	if len(list) != 3 {
		t.Fatalf("admin getPlaylists = %d, want 3", len(list))
	}
	// the retired server ordered by name.
	names := []string{}
	for _, raw := range list {
		names = append(names, raw.(map[string]any)["name"].(string))
	}
	for i := 1; i < len(names); i++ {
		if names[i-1] > names[i] {
			t.Fatalf("getPlaylists not ordered by name: %v", names)
		}
	}
}

func TestGetPlaylistDetailWireShape(t *testing.T) {
	app := newTestApp(t)
	c, ids := setupPlaylistWorld(t, app)

	rec := app.get(t, authedURL("/rest/getPlaylist.view", "&id="+ids["alice-private"]), nil)
	env := assertOK(t, rec)
	p, ok := env["playlist"].(map[string]any)
	if !ok {
		t.Fatalf("missing playlist key: %v", env)
	}
	if p["songCount"] != float64(2) {
		t.Fatalf("songCount = %v", p["songCount"])
	}
	if p["duration"] != float64(441) {
		t.Fatalf("duration = %v", p["duration"])
	}
	if p["coverArt"] != ids["alice-private"] {
		t.Fatalf("coverArt = %v (self-reference placeholder)", p["coverArt"])
	}
	entries, ok := p["entry"].([]any)
	if !ok || len(entries) != 2 {
		t.Fatalf("entry list = %v", p["entry"])
	}
	// the old reduced child: display names, no ids, type/isDir/created.
	first := entries[0].(map[string]any)
	if first["id"] != c.SAbbey1 || first["title"] != "Come Together" ||
		first["album"] != "Abbey Road" || first["artist"] != "The Beatles" {
		t.Fatalf("entry child = %v", first)
	}
	if first["type"] != "music" || first["isDir"] != false {
		t.Fatalf("entry child flags = %v", first)
	}
	if first["track"] != float64(1) {
		t.Fatalf("track = %v", first["track"])
	}
	if _, hasAlbumID := first["albumId"]; hasAlbumID {
		t.Fatalf("the old playlist child has no albumId: %v", first)
	}
	if first["genre"] != "Rock" {
		t.Fatalf("genre = %v", first["genre"])
	}
	if first["year"] != float64(1969) {
		t.Fatalf("year = %v", first["year"])
	}
	if _, hasExplicit := first["explicit"]; !hasExplicit {
		t.Fatalf("explicit must render (false, not omitted): %v", first)
	}
}

func TestGetPlaylistAccessAndMissing(t *testing.T) {
	app := newTestApp(t)
	_, ids := setupPlaylistWorld(t, app)

	// Missing playlist → 70.
	rec := app.get(t, authedURL("/rest/getPlaylist.view", "&id=pl-nope"), nil)
	assertFailed(t, rec, CodeForbidden)

	// Someone else's private playlist → 50 (the old adapter code).
	rec = app.get(t, authedURL("/rest/getPlaylist.view", "&id="+ids["admin-private"]), nil)
	env := assertFailed(t, rec, CodeDataNotFound)
	if msg := env["error"].(map[string]any)["message"]; msg != "User is not authorized for this operation" {
		t.Fatalf("message = %v", msg)
	}

	// Public playlist → viewable by anyone signed in.
	rec = app.get(t, authedURL("/rest/getPlaylist.view", "&id="+ids["admin-public"]), nil)
	assertOK(t, rec)

	// Shared (view-only) → viewable.
	rec = app.get(t, authedURL("/rest/getPlaylist.view", "&id="+ids["admin-shared"]), nil)
	assertOK(t, rec)
}

func TestGetPlaylistAnonymousShareToken(t *testing.T) {
	app := newTestApp(t)
	c, _ := setupPlaylistWorld(t, app)
	ctx := context.Background()

	link, err := app.playlists.Create(ctx, identityFor(c.Admin), playlists.Input{
		Name: "Link Mix", Visibility: "link", SongIDs: []string{c.SAbbey1},
	})
	if err != nil {
		t.Fatal(err)
	}
	if link.ShareToken == "" {
		t.Fatal("link visibility must mint a token")
	}

	// Anonymous + the right token reads the playlist (A8 hook bypass + P1
	// ONE-policy token validation). No credentials at all.
	rec := app.get(t, "/rest/getPlaylist.view?id="+link.ID+"&shareToken="+link.ShareToken, nil)
	env := assertOK(t, rec)
	p := env["playlist"].(map[string]any)
	if p["public"] != true { // link counts as public on the wire (old behavior)
		t.Fatalf("public = %v", p["public"])
	}
	if len(p["entry"].([]any)) != 1 {
		t.Fatalf("entries = %v", p["entry"])
	}

	// Wrong token → 50.
	rec = app.get(t, "/rest/getPlaylist.view?id="+link.ID+"&shareToken=wrong", nil)
	assertFailed(t, rec, CodeDataNotFound)

	// Anonymous without a token never reaches the handler (A6: 10).
	rec = app.get(t, "/rest/getPlaylist.view?id="+link.ID, nil)
	assertFailed(t, rec, CodeMissingParam)
}

func TestCreatePlaylistCreates(t *testing.T) {
	app := newTestApp(t)
	c, _ := setupPlaylistWorld(t, app)

	rec := app.get(t, authedURL("/rest/createPlaylist.view",
		"&name=Subsonic+New&songId="+c.SAbbey1), nil)
	env := assertOK(t, rec)
	p := env["playlist"].(map[string]any)
	if p["name"] != "Subsonic New" {
		t.Fatalf("name = %v", p["name"])
	}
	if p["songCount"] != float64(1) || p["duration"] != float64(259) {
		t.Fatalf("count/duration = %v/%v", p["songCount"], p["duration"])
	}
	if len(p["entry"].([]any)) != 1 {
		t.Fatalf("create answers the entries: %v", p)
	}

	// Default name (retired: "New Playlist").
	rec = app.get(t, authedURL("/rest/createPlaylist.view", "&songId="+c.SAbbey2), nil)
	env = assertOK(t, rec)
	if env["playlist"].(map[string]any)["name"] != "New Playlist" {
		t.Fatalf("default name = %v", env["playlist"])
	}

	// visibility=link mints a token and reports public.
	rec = app.get(t, authedURL("/rest/createPlaylist.view",
		"&name=Linked&visibility=link&songId="+c.SAbbey1), nil)
	env = assertOK(t, rec)
	linked := env["playlist"].(map[string]any)
	if linked["public"] != true {
		t.Fatalf("link public = %v", linked)
	}
	var token string
	if err := app.db.QueryRow(`SELECT share_token FROM playlists WHERE id = ?`, linked["id"]).
		Scan(&token); err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("visibility=link must mint a share token")
	}
}

func TestCreatePlaylistValidatesSongsThroughTheService(t *testing.T) {
	app := newTestApp(t)
	_, _ = setupPlaylistWorld(t, app)

	// Unknown song id: the retired server stored it silently; the Go server delegates to the playlists
	// service (one validation path) and answers enveloped 10.
	rec := app.get(t, authedURL("/rest/createPlaylist.view", "&name=X&songId=s-nope"), nil)
	assertFailed(t, rec, CodeMissingParam)

	// Out-of-scope song for alice (Low lives in lib-b).
	rec = app.get(t, authedURL("/rest/createPlaylist.view", "&name=X&songId=s-low-1"), nil)
	assertFailed(t, rec, CodeMissingParam)
}

func TestCreatePlaylistWithIDReplacesSongs(t *testing.T) {
	app := newTestApp(t)
	c, ids := setupPlaylistWorld(t, app)

	rec := app.get(t, authedURL("/rest/createPlaylist.view",
		"&playlistId="+ids["alice-private"]+"&songId="+c.SAbbey2), nil)
	env := assertOK(t, rec)
	p := env["playlist"].(map[string]any)
	entries := p["entry"].([]any)
	if len(entries) != 1 || entries[0].(map[string]any)["id"] != c.SAbbey2 {
		t.Fatalf("playlistId branch must replace the songs: %v", entries)
	}

	// Unknown playlistId → 70.
	rec = app.get(t, authedURL("/rest/createPlaylist.view",
		"&playlistId=pl-nope&songId="+c.SAbbey1), nil)
	assertFailed(t, rec, CodeForbidden)

	// Someone else's playlist → 50.
	rec = app.get(t, authedURL("/rest/createPlaylist.view",
		"&playlistId="+ids["admin-private"]+"&songId="+c.SAbbey1), nil)
	assertFailed(t, rec, CodeDataNotFound)
}

func TestCreateUpdatePlaylistSmartIs50(t *testing.T) {
	app := newTestApp(t)
	c, _ := setupPlaylistWorld(t, app)
	ctx := context.Background()

	smart, err := app.playlists.Create(ctx, identityFor(testUserID), playlists.Input{
		Name: "Smart", Rules: &playlists.Rules{},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = c

	rec := app.get(t, authedURL("/rest/createPlaylist.view",
		"&playlistId="+smart.ID+"&songId=s-abbey-1"), nil)
	env := assertFailed(t, rec, CodeDataNotFound)
	if msg := env["error"].(map[string]any)["message"]; msg != "Smart playlists cannot be edited through this endpoint" {
		t.Fatalf("message = %v", msg)
	}

	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+smart.ID+"&name=X"), nil)
	assertFailed(t, rec, CodeDataNotFound)
}

func TestUpdatePlaylistSongOps(t *testing.T) {
	app := newTestApp(t)
	c, ids := setupPlaylistWorld(t, app)
	id := ids["alice-private"]

	entriesOf := func() []string {
		t.Helper()
		rec := app.get(t, authedURL("/rest/getPlaylist.view", "&id="+id), nil)
		env := assertOK(t, rec)
		out := []string{}
		for _, raw := range env["playlist"].(map[string]any)["entry"].([]any) {
			out = append(out, raw.(map[string]any)["id"].(string))
		}
		return out
	}
	assertIDs := func(want ...string) {
		t.Helper()
		got := entriesOf()
		if fmt.Sprintf("%v", got) != fmt.Sprintf("%v", want) {
			t.Fatalf("members = %v, want %v", got, want)
		}
	}
	// Seed starts as [abbey1, abbey2].

	// songId REPLACES the list.
	rec := app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+id+"&songId="+c.SAbbey1), nil)
	assertOK(t, rec)
	assertIDs(c.SAbbey1)

	// songIdToAdd APPENDS.
	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+id+"&songIdToAdd="+c.SAbbey2), nil)
	assertOK(t, rec)
	assertIDs(c.SAbbey1, c.SAbbey2)

	// songIndexToRemove splices; out-of-range and non-numeric are ignored
	// (the old semantics).
	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+id+"&songIndexToRemove=0&songIndexToRemove=abc&songIndexToRemove=9"), nil)
	assertOK(t, rec)
	assertIDs(c.SAbbey2)

	// No song params at all leaves the members alone.
	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+id+"&name=Renamed"), nil)
	assertOK(t, rec)
	assertIDs(c.SAbbey2)
	var name string
	if err := app.db.QueryRow(`SELECT name FROM playlists WHERE id = ?`, id).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "Renamed" {
		t.Fatalf("name = %q", name)
	}
}

func TestUpdatePlaylistVisibilityTokenLifecycle(t *testing.T) {
	app := newTestApp(t)
	_, ids := setupPlaylistWorld(t, app)
	id := ids["alice-private"]

	// the retired server opensubsonic-routes.ts updatePlaylist: the token is re-derived
	// from the RESOLVED visibility on every adapter update — link keeps or
	// mints a token, any other visibility clears it.
	rec := app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+id+"&visibility=link"), nil)
	assertOK(t, rec)
	var token string
	if err := app.db.QueryRow(`SELECT share_token FROM playlists WHERE id = ?`, id).Scan(&token); err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("visibility=link must mint a token")
	}

	// link → link keeps the same token (no rotation).
	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+id+"&visibility=link&name=StillLinked"), nil)
	assertOK(t, rec)
	var kept string
	if err := app.db.QueryRow(`SELECT share_token FROM playlists WHERE id = ?`, id).Scan(&kept); err != nil {
		t.Fatal(err)
	}
	if kept != token {
		t.Fatalf("link→link rotated the token: %q → %q", token, kept)
	}

	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+id+"&visibility=private"), nil)
	assertOK(t, rec)
	var cleared sql.NullString
	if err := app.db.QueryRow(`SELECT share_token FROM playlists WHERE id = ?`, id).
		Scan(&cleared); err != nil {
		t.Fatal(err)
	}
	if cleared.Valid {
		t.Fatalf("leaving link must clear the token, got %q", cleared.String)
	}

	// A name-only update on a non-link playlist also clears any token
	// (the resolved visibility — existing — is not link). Seed a token
	// the way the native share-link endpoint does.
	if _, err := app.db.Exec(`UPDATE playlists SET share_token = 'native-token' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+id+"&name=RenamedAgain"), nil)
	assertOK(t, rec)
	var after sql.NullString
	if err := app.db.QueryRow(`SELECT share_token FROM playlists WHERE id = ?`, id).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after.Valid {
		t.Fatalf("adapter update re-derives the token from resolved visibility: want cleared, got %q", after.String)
	}
}

func TestUpdatePlaylistAccess(t *testing.T) {
	app := newTestApp(t)
	_, ids := setupPlaylistWorld(t, app)

	rec := app.get(t, authedURL("/rest/updatePlaylist.view", "&playlistId=pl-nope"), nil)
	assertFailed(t, rec, CodeForbidden)

	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+ids["admin-private"]+"&name=Hijack"), nil)
	assertFailed(t, rec, CodeDataNotFound)

	// alice has view-only access to Root Shared: update → 50.
	rec = app.get(t, authedURL("/rest/updatePlaylist.view",
		"&playlistId="+ids["admin-shared"]+"&name=Hijack"), nil)
	assertFailed(t, rec, CodeDataNotFound)
}

func TestDeletePlaylistV1Semantics(t *testing.T) {
	app := newTestApp(t)
	_, ids := setupPlaylistWorld(t, app)

	// Missing playlist: the retired server answers a silent OK, NOT 70.
	rec := app.get(t, authedURL("/rest/deletePlaylist.view", "&id=pl-nope"), nil)
	assertOK(t, rec)

	// Someone else's playlist without edit access → 50: alice may VIEW Root
	// Public but not delete it.
	rec = app.get(t, authedURL("/rest/deletePlaylist.view", "&id="+ids["admin-public"]), nil)
	if code := errorCodeOf(t, rec); code != CodeDataNotFound {
		t.Fatalf("delete of a public non-owned playlist = code %v, want 50", code)
	}

	// bob holds an EDIT share on Root Secret: the Subsonic verb rule is
	// editor-or-owner (old canEditOrOwnPlaylist), so the delete lands —
	// unlike the native owner-only route.
	rec = app.get(t, authedURLAs("bob", "bobpass", "/rest/deletePlaylist.view",
		"&id="+ids["admin-private"]), nil)
	assertOK(t, rec)
	var n int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM playlists WHERE id = ?`, ids["admin-private"]).
		Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("editor share must delete via the Subsonic endpoint (old verb rule)")
	}

	// Owner deletes their own.
	rec = app.get(t, authedURL("/rest/deletePlaylist.view", "&id="+ids["alice-private"]), nil)
	assertOK(t, rec)
}

func errorCodeOf(t *testing.T, rec *httptest.ResponseRecorder) float64 {
	t.Helper()
	var body struct {
		Response map[string]any `json:"subsonic-response"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body.Response["error"].(map[string]any)["code"].(float64)
}

func TestPlaylistEndpointsXML(t *testing.T) {
	app := newTestApp(t)
	c, ids := setupPlaylistWorld(t, app)

	rec := app.get(t, authedURL("/rest/getPlaylist.view", "&id="+ids["alice-private"]+"&f=xml"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d", rec.Code)
	}
	body := rec.Body.String()
	for _, check := range []string{
		fmt.Sprintf(`<playlist id="%s"`, ids["alice-private"]),
		`name="Alice Mix"`,
		`owner="alice"`,
		`public="false"`,
		`songCount="2"`,
		`duration="441"`,
		fmt.Sprintf(`coverArt="%s"`, ids["alice-private"]),
		`created="`,
		`changed="`,
		fmt.Sprintf(`<entry id="%s"`, c.SAbbey1),
		`title="Come Together"`,
		`album="Abbey Road"`,
		`artist="The Beatles"`,
		`type="music"`,
		`isDir="false"`,
		`explicit="false"`,
	} {
		if !strings.Contains(body, check) {
			t.Fatalf("getPlaylist XML missing %q:\n%s", check, body)
		}
	}

	// getPlaylists: repeated <playlist> children under <playlists>.
	rec = app.get(t, authedURL("/rest/getPlaylists.view", "&f=xml"), nil)
	body = rec.Body.String()
	if !strings.Contains(body, "<playlists>") {
		t.Fatalf("getPlaylists XML: %s", body)
	}
	if !strings.Contains(body, `name="Root Public"`) || !strings.Contains(body, `public="true"`) {
		t.Fatalf("getPlaylists XML missing the public playlist:\n%s", body)
	}
	if strings.Contains(body, "Root Secret") {
		t.Fatalf("private playlist leaked into getPlaylists XML:\n%s", body)
	}
}

func TestPlaylistAuthMatrix(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedAPIKey(t, testAPIKey, testUserID)

	endpoints := []string{
		"/rest/getPlaylists.view", "/rest/getPlaylist.view",
		"/rest/createPlaylist.view", "/rest/updatePlaylist.view",
		"/rest/deletePlaylist.view",
	}
	for _, path := range endpoints {
		rec := app.get(t, path+"?apiKey="+wrongAPIKey, nil)
		assertFailed(t, rec, CodeUnauthorized)
		rec = app.get(t, path, nil)
		assertFailed(t, rec, CodeMissingParam)
	}
}
