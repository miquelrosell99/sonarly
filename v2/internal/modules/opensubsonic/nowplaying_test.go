package opensubsonic

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/playback"
)

// recordStream simulates one authorized stream landing in the P8 tracker
// (production wiring goes through the playback service's recorder hook).
func recordStream(app *testApp, userID, client, songID, title, artistID string, duration int) {
	r := httptest.NewRequest(http.MethodGet, "/api/stream/"+songID+"?c="+client, nil)
	d := duration
	app.tracker.RecordStream(r, userID, playback.StreamEvent{
		SongID: songID, Title: title, ArtistID: &artistID, Duration: &d,
	})
}

func TestGetNowPlayingShape(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	recordStream(app, testUserID, "symfonium", c.SAbbey1, "Come Together", c.ArBeatles, 259)
	recordStream(app, c.Admin, "ultrasonic", c.SLow1, "Speed of Life", c.ArBowie, 146)

	rec := app.get(t, authedURL("/rest/getNowPlaying.view", ""), nil)
	env := assertOK(t, rec)
	np, ok := env["nowPlaying"].(map[string]any)
	if !ok {
		t.Fatalf("missing nowPlaying key: %v", env)
	}
	entries := np["entry"].([]any)
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	byPlayer := map[string]map[string]any{}
	for _, raw := range entries {
		e := raw.(map[string]any)
		byPlayer[e["playerName"].(string)] = e
	}
	alice := byPlayer["symfonium"]
	if alice["username"] != testUser {
		t.Fatalf("username = %v", alice["username"])
	}
	// v2 tracker key: user + device (P8 deviation, documented in N1).
	if alice["playerId"] != testUserID+"|symfonium" {
		t.Fatalf("playerId = %v", alice["playerId"])
	}
	if alice["minutesAgo"] != float64(0) {
		t.Fatalf("minutesAgo = %v", alice["minutesAgo"])
	}
	child, ok := alice["entry"].(map[string]any)
	if !ok {
		t.Fatalf("entry child missing: %v", alice)
	}
	if child["id"] != c.SAbbey1 || child["title"] != "Come Together" {
		t.Fatalf("entry child = %v", child)
	}
	// The song child carries the caller's interaction context (X14).
	if _, starred := child["starred"]; starred {
		t.Fatalf("no interaction row → no starred key: %v", child)
	}
	root := byPlayer["ultrasonic"]
	if root["username"] != "root" {
		t.Fatalf("root username = %v", root["username"])
	}
}

func TestGetNowPlayingMinutesAgoFloored(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	// Record 3m30s in the past: the floor makes it 3 (v1 Math.floor).
	past := time.Now().Add(-(3*time.Minute + 30*time.Second))
	app.tracker.SetClock(func() time.Time { return past })
	recordStream(app, testUserID, "symfonium", c.SAbbey1, "Come Together", c.ArBeatles, 259)
	app.tracker.SetClock(nil)

	rec := app.get(t, authedURL("/rest/getNowPlaying.view", ""), nil)
	env := assertOK(t, rec)
	entries := env["nowPlaying"].(map[string]any)["entry"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(entries))
	}
	if got := entries[0].(map[string]any)["minutesAgo"]; got != float64(3) {
		t.Fatalf("minutesAgo = %v, want 3", got)
	}
}

func TestGetNowPlayingExpiry(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	// The 5-minute TTL prunes stale players lazily on read (N1).
	past := time.Now().Add(-6 * time.Minute)
	app.tracker.SetClock(func() time.Time { return past })
	recordStream(app, testUserID, "symfonium", c.SAbbey1, "Come Together", c.ArBeatles, 259)
	app.tracker.SetClock(nil)

	rec := app.get(t, authedURL("/rest/getNowPlaying.view", ""), nil)
	env := assertOK(t, rec)
	entries := env["nowPlaying"].(map[string]any)["entry"].([]any)
	if len(entries) != 0 {
		t.Fatalf("expired players must drop out, got %d", len(entries))
	}
	if app.tracker.Count() != 0 {
		t.Fatalf("expired entry must be pruned from the registry")
	}
}

func TestGetNowPlayingSongVanished(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	recordStream(app, testUserID, "symfonium", c.SLow1, "Speed of Life", c.ArBowie, 146)
	// The song leaves the catalog: the entry stays, the child omits (v1
	// answered entry: undefined, JSON drops the key).
	app.exec(t, `UPDATE songs SET active = 0 WHERE id = ?`, c.SLow1)

	rec := app.get(t, authedURL("/rest/getNowPlaying.view", ""), nil)
	env := assertOK(t, rec)
	entries := env["nowPlaying"].(map[string]any)["entry"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(entries))
	}
	if _, hasChild := entries[0].(map[string]any)["entry"]; hasChild {
		t.Fatalf("vanished song must render without a child: %v", entries[0])
	}
}

func TestGetNowPlayingEmptyList(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getNowPlaying.view", ""), nil)
	env := assertOK(t, rec)
	np := env["nowPlaying"].(map[string]any)
	if got := np["entry"].([]any); len(got) != 0 {
		t.Fatalf("empty nowPlaying = %v", got)
	}

	// XML: the empty entry list produces no elements (E7).
	rec = app.get(t, authedURL("/rest/getNowPlaying.view", "&f=xml"), nil)
	body := rec.Body.String()
	if !strings.Contains(body, "<nowPlaying>") || strings.Contains(body, "<entry") {
		t.Fatalf("empty nowPlaying XML: %s", body)
	}
}

func TestGetNowPlayingXML(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	recordStream(app, testUserID, "symfonium", c.SAbbey1, "Come Together", c.ArBeatles, 259)

	rec := app.get(t, authedURL("/rest/getNowPlaying.view", "&f=xml"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d", rec.Code)
	}
	body := rec.Body.String()
	playerID := fmt.Sprintf(`playerId="%s|symfonium"`, testUserID)
	for _, check := range []string{
		`<nowPlaying>`,
		`<entry username="alice"`,
		playerID,
		`minutesAgo="0"`,
		`playerName="symfonium"`,
		fmt.Sprintf(`<entry id="%s"`, c.SAbbey1),
	} {
		if !strings.Contains(body, check) {
			t.Fatalf("getNowPlaying XML missing %q:\n%s", check, body)
		}
	}
}

func TestGetNowPlayingAnonymousIs10(t *testing.T) {
	app := newTestApp(t)
	rec := app.get(t, "/rest/getNowPlaying.view", nil)
	assertFailed(t, rec, CodeMissingParam)
}
