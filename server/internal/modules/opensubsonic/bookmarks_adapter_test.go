package opensubsonic

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func seedBookmarkWorld(t *testing.T) (*testApp, catalogIDs) {
	t.Helper()
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	return app, c
}

func TestCreateBookmarkValidation(t *testing.T) {
	app, c := seedBookmarkWorld(t)

	cases := []struct {
		name  string
		extra string
		code  float64
	}{
		{"missing id", "&position=10", CodeMissingParam},
		{"missing position", "&id=" + c.SAbbey1, CodeMissingParam},
		{"empty position", "&id=" + c.SAbbey1 + "&position=", CodeMissingParam},
		{"non-numeric position", "&id=" + c.SAbbey1 + "&position=abc", CodeMissingParam},
		{"negative position", "&id=" + c.SAbbey1 + "&position=-5", CodeMissingParam},
		{"fractional position", "&id=" + c.SAbbey1 + "&position=1.5", CodeMissingParam},
		{"unknown song", "&id=s-nope&position=3", CodeForbidden},
		// v2 one-path delta: the playback service enforces scope, so a
		// lib-b song is a data-not-found for alice (v1 checked liveness
		// only — recorded in the quirks doc).
		{"out of scope song", "&id=" + c.SLow1 + "&position=3", CodeForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := app.get(t, authedURL("/rest/createBookmark.view", tc.extra), nil)
			assertFailed(t, rec, tc.code)
		})
	}

	var n int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM bookmarks WHERE user_id = ?`, testUserID).
		Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("failed creates must write nothing, found %d rows", n)
	}
}

func TestCreateBookmarkRoundTrip(t *testing.T) {
	app, c := seedBookmarkWorld(t)

	rec := app.get(t, authedURL("/rest/createBookmark.view",
		"&id="+c.SAbbey1+"&position=42&comment=halfway"), nil)
	assertOK(t, rec)

	var position int
	var comment string
	if err := app.db.QueryRow(`SELECT position, comment FROM bookmarks WHERE user_id = ? AND song_id = ?`,
		testUserID, c.SAbbey1).Scan(&position, &comment); err != nil {
		t.Fatal(err)
	}
	if position != 42 || comment != "halfway" {
		t.Fatalf("bookmark = %d/%q", position, comment)
	}

	// Re-create upserts: position replaced, comment cleared (v1's
	// createBookmark wrote comment ?? null on every upsert).
	rec = app.get(t, authedURL("/rest/createBookmark.view",
		"&id="+c.SAbbey1+"&position=100"), nil)
	assertOK(t, rec)
	var cleared sql.NullString
	if err := app.db.QueryRow(`SELECT position, comment FROM bookmarks WHERE user_id = ? AND song_id = ?`,
		testUserID, c.SAbbey1).Scan(&position, &cleared); err != nil {
		t.Fatal(err)
	}
	if position != 100 {
		t.Fatalf("upserted position = %d", position)
	}
	if cleared.Valid {
		t.Fatalf("comment must be cleared on re-create, got %q", cleared.String)
	}
}

func TestGetBookmarksShape(t *testing.T) {
	app, c := seedBookmarkWorld(t)

	app.get(t, authedURL("/rest/createBookmark.view", "&id="+c.SAbbey1+"&position=42&comment=halfway"), nil)
	app.get(t, authedURL("/rest/createBookmark.view", "&id="+c.SAbbey2+"&position=7"), nil)
	// A bookmark whose song is out of scope stays in the list with the
	// entry omitted (v1 getBookmarks.view behavior).
	app.exec(t, `INSERT INTO bookmarks (user_id, song_id, position) VALUES (?, ?, 3)`, testUserID, c.SLow1)

	rec := app.get(t, authedURL("/rest/getBookmarks.view", ""), nil)
	env := assertOK(t, rec)
	bookmarks, ok := env["bookmarks"].(map[string]any)["bookmark"].([]any)
	if !ok || len(bookmarks) != 3 {
		t.Fatalf("bookmarks = %v", env["bookmarks"])
	}
	withChild, withoutChild := 0, 0
	for _, raw := range bookmarks {
		b := raw.(map[string]any)
		if b["username"] != testUser {
			t.Fatalf("username = %v", b["username"])
		}
		if b["position"] == nil || b["created"] == nil || b["changed"] == nil {
			t.Fatalf("bookmark fields missing: %v", b)
		}
		if _, ok := b["entry"].(map[string]any); ok {
			withChild++
		} else {
			withoutChild++
		}
	}
	if withChild != 2 || withoutChild != 1 {
		t.Fatalf("entries with/without child = %d/%d, want 2/1", withChild, withoutChild)
	}
}

func TestGetBookmarksEmpty(t *testing.T) {
	app, _ := seedBookmarkWorld(t)

	rec := app.get(t, authedURL("/rest/getBookmarks.view", ""), nil)
	env := assertOK(t, rec)
	list := env["bookmarks"].(map[string]any)["bookmark"].([]any)
	if len(list) != 0 {
		t.Fatalf("empty bookmarks = %v", list)
	}

	rec = app.get(t, authedURL("/rest/getBookmarks.view", "&f=xml"), nil)
	body := rec.Body.String()
	if !strings.Contains(body, "<bookmarks>") || strings.Contains(body, "<bookmark ") {
		t.Fatalf("empty bookmarks XML: %s", body)
	}
}

func TestGetBookmarksXML(t *testing.T) {
	app, c := seedBookmarkWorld(t)
	app.get(t, authedURL("/rest/createBookmark.view",
		"&id="+c.SAbbey1+"&position=42&comment=halfway"), nil)

	rec := app.get(t, authedURL("/rest/getBookmarks.view", "&f=xml"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d", rec.Code)
	}
	body := rec.Body.String()
	for _, check := range []string{
		`<bookmarks>`,
		`username="alice"`,
		`position="42"`,
		`comment="halfway"`,
		fmt.Sprintf(`<entry id="%s"`, c.SAbbey1),
		`title="Come Together"`,
	} {
		if !strings.Contains(body, check) {
			t.Fatalf("getBookmarks XML missing %q:\n%s", check, body)
		}
	}
}

func TestDeleteBookmark(t *testing.T) {
	app, c := seedBookmarkWorld(t)

	// Missing id → 10.
	rec := app.get(t, authedURL("/rest/deleteBookmark.view", ""), nil)
	assertFailed(t, rec, CodeMissingParam)

	app.get(t, authedURL("/rest/createBookmark.view", "&id="+c.SAbbey1+"&position=42"), nil)

	// Deleting works and is idempotent (v1: missing bookmark is a no-op).
	rec = app.get(t, authedURL("/rest/deleteBookmark.view", "&id="+c.SAbbey1), nil)
	assertOK(t, rec)
	rec = app.get(t, authedURL("/rest/deleteBookmark.view", "&id="+c.SAbbey1), nil)
	assertOK(t, rec)

	var n int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM bookmarks WHERE user_id = ?`, testUserID).
		Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("bookmark not deleted (%d rows)", n)
	}

	// v2 one-path delta: an out-of-scope/inactive song answers 70 through
	// the playback service (v1 deleted unconditionally).
	rec = app.get(t, authedURL("/rest/deleteBookmark.view", "&id="+c.SLow1), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestBookmarkAuthMatrix(t *testing.T) {
	app, _ := seedBookmarkWorld(t)
	app.seedAPIKey(t, testAPIKey, testUserID)

	for _, path := range []string{
		"/rest/getBookmarks.view", "/rest/createBookmark.view", "/rest/deleteBookmark.view",
	} {
		rec := app.get(t, path+"?apiKey="+wrongAPIKey, nil)
		assertFailed(t, rec, CodeUnauthorized)
		rec = app.get(t, path, nil)
		assertFailed(t, rec, CodeMissingParam)
	}
}
