package opensubsonic

import (
	"fmt"
	"strings"
	"testing"
)

// seedLibrary inserts a library row; ids are returned in name order by the
// admin folder query, so names keep the expected order deterministic.
func (a *testApp) seedLibrary(t *testing.T, id, name string) {
	t.Helper()
	_, err := a.db.Exec(
		`INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
		id, name, "/music/"+id)
	if err != nil {
		t.Fatalf("seed library: %v", err)
	}
}

func (a *testApp) assignLibrary(t *testing.T, userID, libraryID string) {
	t.Helper()
	_, err := a.db.Exec(
		`INSERT INTO user_libraries (user_id, library_id) VALUES (?, ?)`, userID, libraryID)
	if err != nil {
		t.Fatalf("assign library: %v", err)
	}
}

func TestPingJSON(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	rec := app.get(t, authedURL("/rest/ping.view", "&f=json"), nil)
	env := assertOK(t, rec)
	if _, extra := env["license"]; extra {
		t.Fatalf("ping must carry no data keys: %v", env)
	}
}

func TestPingXML(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	rec := app.get(t, authedURL("/rest/ping.view", "&f=xml"), nil)
	if ct := rec.Header().Get("Content-Type"); ct != "application/xml" {
		t.Fatalf("content-type = %q, want application/xml", ct)
	}
	body := rec.Body.String()
	for _, check := range []string{`<subsonic-response`, `status="ok"`, `openSubsonic="true"`} {
		if !strings.Contains(body, check) {
			t.Fatalf("ping XML missing %q: %s", check, body)
		}
	}
}

func TestGetLicense(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	rec := app.get(t, authedURL("/rest/getLicense.view", ""), nil)
	env := assertOK(t, rec)
	license, ok := env["license"].(map[string]any)
	if !ok || license["valid"] != true {
		t.Fatalf("license = %v", env)
	}
}

func TestGetOpenSubsonicExtensions(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	rec := app.get(t, authedURL("/rest/getOpenSubsonicExtensions.view", ""), nil)
	env := assertOK(t, rec)
	list, ok := env["openSubsonicExtensions"].([]any)
	if !ok || len(list) != 0 {
		t.Fatalf("extensions = %v", env)
	}
}

func TestGetUserRoleMatrix(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)

	rec := app.get(t, authedURL("/rest/getUser.view", ""), nil)
	env := assertOK(t, rec)
	user, ok := env["user"].(map[string]any)
	if !ok {
		t.Fatalf("user = %v", env)
	}
	want := map[string]any{
		"username":          testUser,
		"adminRole":         true,
		"commentRole":       true,
		"coverArtRole":      true,
		"downloadRole":      true,
		"jukeboxRole":       false,
		"playlistRole":      true,
		"podcastRole":       false,
		"scrobblingEnabled": true,
		"settingsRole":      true,
		"shareRole":         false,
		"streamRole":        true,
		"uploadRole":        true,
	}
	for key, wantVal := range want {
		if user[key] != wantVal {
			t.Fatalf("user[%q] = %v, want %v (full: %v)", key, user[key], wantVal, user)
		}
	}
}

func TestGetUserAdminSeesAllLibraries(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedLibrary(t, "lib-b", "Beta")
	app.seedLibrary(t, "lib-a", "Alpha")

	rec := app.get(t, authedURL("/rest/getUser.view", ""), nil)
	env := assertOK(t, rec)
	user := env["user"].(map[string]any)
	// Admin folder list = every library, ordered by name: lib-a, lib-b.
	folders, ok := user["folder"].([]any)
	if !ok || len(folders) != 2 || folders[0] != "lib-a" || folders[1] != "lib-b" {
		t.Fatalf("admin folders = %v", user["folder"])
	}
}

func TestGetUserScopedFolders(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedLibrary(t, "lib-a", "Alpha")
	app.seedLibrary(t, "lib-b", "Beta")
	app.seedLibrary(t, "lib-c", "Gamma")
	app.assignLibrary(t, testUserID, "lib-b")

	rec := app.get(t, authedURL("/rest/getUser.view", ""), nil)
	env := assertOK(t, rec)
	user := env["user"].(map[string]any)
	if user["adminRole"] != false || user["uploadRole"] != false || user["settingsRole"] != false {
		t.Fatalf("non-admin roles = %v", user)
	}
	folders, ok := user["folder"].([]any)
	if !ok || len(folders) != 1 || folders[0] != "lib-b" {
		t.Fatalf("scoped folders = %v", user["folder"])
	}
}

func TestGetUserEmptyScopeEmptyFolders(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedLibrary(t, "lib-a", "Alpha")

	rec := app.get(t, authedURL("/rest/getUser.view", ""), nil)
	env := assertOK(t, rec)
	user := env["user"].(map[string]any)
	folders, ok := user["folder"].([]any)
	if !ok || len(folders) != 0 {
		t.Fatalf("empty scope must render folder as [], got %v", user["folder"])
	}
}

func TestGetUserTranscodingPrefs(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	if _, err := app.db.Exec(
		`UPDATE users SET max_bitrate_kbps = 256, transcode_format = 'opus' WHERE id = ?`, testUserID); err != nil {
		t.Fatalf("set transcoding prefs: %v", err)
	}

	rec := app.get(t, authedURL("/rest/getUser.view", ""), nil)
	env := assertOK(t, rec)
	user := env["user"].(map[string]any)
	if user["maxBitRate"] != float64(256) || user["transcodeFormat"] != "opus" {
		t.Fatalf("transcoding prefs = %v", user)
	}
}

func TestGetUserOmitsUnsetTranscodingPrefs(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	rec := app.get(t, authedURL("/rest/getUser.view", ""), nil)
	env := assertOK(t, rec)
	user := env["user"].(map[string]any)
	if _, present := user["maxBitRate"]; present {
		t.Fatalf("unset maxBitRate must be omitted (old spreads undefined): %v", user)
	}
	if _, present := user["transcodeFormat"]; present {
		t.Fatalf("unset transcodeFormat must be omitted: %v", user)
	}
}

func TestGetUserXMLFolders(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedLibrary(t, "lib-a", "Alpha")
	app.assignLibrary(t, testUserID, "lib-a")

	rec := app.get(t, authedURL("/rest/getUser.view", "&f=xml"), nil)
	body := rec.Body.String()
	for _, check := range []string{
		fmt.Sprintf(`username="%s"`, testUser),
		`adminRole="false"`,
		`<folder>lib-a</folder>`,
	} {
		if !strings.Contains(body, check) {
			t.Fatalf("getUser XML missing %q:\n%s", check, body)
		}
	}
}

func TestUnknownRouteEnvelopedError(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	// E5: unknown /rest/* answers an enveloped error 0 instead of the old bare
	// Fastify 404 — Subsonic clients get a parseable envelope. The path is
	// deliberately NOT one of the adapter's endpoints (getStarred and
	// friends landed in P9b).
	rec := app.get(t, authedURL("/rest/getStarred3.view", ""), nil)
	env := assertFailed(t, rec, CodeNotImplemented)
	errObj := env["error"].(map[string]any)
	if errObj["message"] != "Not implemented" {
		t.Fatalf("message = %v", errObj)
	}

	rec = app.get(t, authedURL("/rest/doesNotExist", ""), nil)
	assertFailed(t, rec, CodeNotImplemented)
}

func TestUnknownRouteXML(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)

	rec := app.get(t, authedURL("/rest/getStarred3.view", "&f=xml"), nil)
	body := rec.Body.String()
	if !strings.Contains(body, `status="failed"`) || !strings.Contains(body, `code="0"`) {
		t.Fatalf("unknown-route XML envelope: %s", body)
	}
}
