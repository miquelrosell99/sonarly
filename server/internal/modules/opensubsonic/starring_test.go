package opensubsonic

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// authedURLAs builds a /rest URL with u/t/s credentials for an arbitrary
// user (the shared authedURL helper is pinned to the alice fixture).
func authedURLAs(user, pass, path, extra string) string {
	return fmt.Sprintf("%s?u=%s&t=%s&s=%s%s", path, user, tokenFor(pass, testSalt), testSalt, extra)
}

func TestStarWritesJunctionRows(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/star.view",
		"&id="+c.SAbbey1+"&albumId="+c.AlAbbey+"&artistId="+c.ArBeatles), nil)
	assertOK(t, rec)

	assertJunction := func(table, idCol, entityID string, want int) {
		t.Helper()
		var starred int
		err := app.db.QueryRow(`SELECT starred FROM `+table+` WHERE user_id = ? AND `+idCol+` = ?`,
			testUserID, entityID).Scan(&starred)
		if err != nil {
			t.Fatalf("read %s: %v", table, err)
		}
		if starred != want {
			t.Fatalf("%s star = %d, want %d", table, starred, want)
		}
	}
	assertJunction("user_songs", "song_id", c.SAbbey1, 1)
	assertJunction("user_albums", "album_id", c.AlAbbey, 1)
	assertJunction("user_artists", "artist_id", c.ArBeatles, 1)

	// unstar flips the same rows back (one data path with the native API).
	rec = app.get(t, authedURL("/rest/unstar.view", "&id="+c.SAbbey1), nil)
	assertOK(t, rec)
	assertJunction("user_songs", "song_id", c.SAbbey1, 0)
	assertJunction("user_albums", "album_id", c.AlAbbey, 1) // untouched
}

func TestStarMultiIDParams(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	// Repeated id params (comma-free), exactly like the old normalizeIds.
	rec := app.get(t, authedURL("/rest/star.view",
		"&id="+c.SAbbey1+"&id="+c.SAbbey2+"&id="), nil) // empty value filtered out
	assertOK(t, rec)
	var n int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM user_songs WHERE user_id = ? AND starred = 1`,
		testUserID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("starred songs = %d, want 2", n)
	}
}

func TestStarMissingIdIs70AndWritesNothing(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/star.view",
		"&id="+c.SAbbey1+"&albumId=al-does-not-exist"), nil)
	assertFailed(t, rec, CodeForbidden)

	// All-or-nothing: the valid song id must NOT be written (T1).
	var n int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM user_songs WHERE user_id = ?`,
		testUserID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("a 70 star must write nothing, found %d rows", n)
	}
}

func TestSetRatingValidation(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	cases := []struct {
		name    string
		extra   string
		code    float64
		message string
	}{
		{"missing id", "&rating=4", CodeMissingParam, "Missing id parameter"},
		{"missing rating", "&id=" + c.SAbbey1, CodeMissingParam, "Missing or invalid rating parameter"},
		{"empty rating", "&id=" + c.SAbbey1 + "&rating=", CodeMissingParam, "Missing or invalid rating parameter"},
		{"not a number", "&id=" + c.SAbbey1 + "&rating=abc", CodeMissingParam, "Missing or invalid rating parameter"},
		{"quarter step", "&id=" + c.SAbbey1 + "&rating=4.7", CodeMissingParam, "Missing or invalid rating parameter"},
		{"negative", "&id=" + c.SAbbey1 + "&rating=-1", CodeMissingParam, "Missing or invalid rating parameter"},
		{"above five", "&id=" + c.SAbbey1 + "&rating=5.5", CodeMissingParam, "Missing or invalid rating parameter"},
		{"leading dot", "&id=" + c.SAbbey1 + "&rating=.5", CodeMissingParam, "Missing or invalid rating parameter"},
		{"unknown song", "&id=s-nope&rating=4", CodeForbidden, "Data not found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := app.get(t, authedURL("/rest/setRating.view", tc.extra), nil)
			env := assertFailed(t, rec, tc.code)
			errObj := env["error"].(map[string]any)
			if errObj["message"] != tc.message {
				t.Fatalf("message = %v, want %q", errObj["message"], tc.message)
			}
		})
	}

	var n int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM user_songs WHERE user_id = ?`, testUserID).
		Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("failed ratings must write nothing, found %d rows", n)
	}
}

func TestSetRatingHalfStepsAndAverage(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	// The regex accepts 4.5 (old half-ratings).
	rec := app.get(t, authedURL("/rest/setRating.view", "&id="+c.SAbbey1+"&rating=4.5"), nil)
	assertOK(t, rec)

	var rating sql.NullFloat64
	if err := app.db.QueryRow(`SELECT rating FROM user_songs WHERE user_id = ? AND song_id = ?`,
		testUserID, c.SAbbey1).Scan(&rating); err != nil {
		t.Fatal(err)
	}
	if !rating.Valid || rating.Float64 != 4.5 {
		t.Fatalf("rating = %v, want 4.5", rating)
	}

	// A second user drags the average; songs.average_rating recomputes.
	// (seedCatalog already created the root admin.)
	rec = app.get(t, authedURLAs("root", "adminpass", "/rest/setRating.view", "&id="+c.SAbbey1+"&rating=2"), nil)
	assertOK(t, rec)

	var avg sql.NullFloat64
	if err := app.db.QueryRow(`SELECT average_rating FROM songs WHERE id = ?`, c.SAbbey1).
		Scan(&avg); err != nil {
		t.Fatal(err)
	}
	if !avg.Valid || avg.Float64 != 3.25 {
		t.Fatalf("average_rating = %v, want 3.25", avg)
	}
}

func TestScrobbleSubmissionFalseIsNoop(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	for _, submission := range []string{"false", "0", "FALSE"} {
		rec := app.get(t, authedURL("/rest/scrobble.view",
			"&id="+c.SAbbey1+"&submission="+submission), nil)
		assertOK(t, rec)
	}

	var plays, history int
	if err := app.db.QueryRow(`SELECT COALESCE(SUM(play_count),0) FROM user_songs WHERE user_id = ?`,
		testUserID).Scan(&plays); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM listening_history WHERE user_id = ?`,
		testUserID).Scan(&history); err != nil {
		t.Fatal(err)
	}
	if plays != 0 || history != 0 {
		t.Fatalf("submission=false must write nothing: plays=%d history=%d", plays, history)
	}
}

func TestScrobbleWritesThroughPlaybackService(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	// undefined and 'true' both count as submissions (T3).
	rec := app.get(t, authedURL("/rest/scrobble.view", "&id="+c.SAbbey1), nil)
	assertOK(t, rec)
	rec = app.get(t, authedURL("/rest/scrobble.view", "&id="+c.SAbbey1+"&submission=true"), nil)
	assertOK(t, rec)
	var playCount int
	if err := app.db.QueryRow(`SELECT play_count FROM user_songs WHERE user_id = ? AND song_id = ?`,
		testUserID, c.SAbbey1).Scan(&playCount); err != nil {
		t.Fatal(err)
	}
	if playCount != 2 {
		t.Fatalf("play_count = %d, want 2", playCount)
	}
	var client string
	if err := app.db.QueryRow(`SELECT client FROM listening_history WHERE user_id = ?`,
		testUserID).Scan(&client); err != nil {
		t.Fatal(err)
	}
	if client != "subsonic" {
		t.Fatalf("history client = %q, want subsonic", client)
	}
}

func TestScrobbleUnknownSongIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/scrobble.view", "&id=s-nope&id=s-also-nope"), nil)
	assertFailed(t, rec, CodeForbidden)
	var history int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM listening_history WHERE user_id = ?`,
		testUserID).Scan(&history); err != nil {
		t.Fatal(err)
	}
	if history != 0 {
		t.Fatalf("a 70 scrobble must write nothing, found %d rows", history)
	}
}

func TestScrobbleScopeAndLivenessMatchNative(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	// Inactivate one lib-a song.
	app.exec(t, `UPDATE songs SET active = 0 WHERE id = ?`, c.SAbbey2)

	// The adapter delegates to the playback scrobble service, so out-of-
	// scope (lib-b for alice) and inactive songs answer 70 exactly like the
	// native endpoint would 404 (old behavior: existence only — the Go-server delta
	// is recorded in the quirks doc).
	rec := app.get(t, authedURL("/rest/scrobble.view", "&id="+c.SLow1), nil)
	assertFailed(t, rec, CodeForbidden)
	rec = app.get(t, authedURL("/rest/scrobble.view", "&id="+c.SAbbey2), nil)
	assertFailed(t, rec, CodeForbidden)

	var history int
	if err := app.db.QueryRow(`SELECT COUNT(*) FROM listening_history WHERE user_id = ?`,
		testUserID).Scan(&history); err != nil {
		t.Fatal(err)
	}
	if history != 0 {
		t.Fatalf("failed scrobbles must write nothing, found %d rows", history)
	}
}

func TestGetStarredRoundTrip(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")

	app.get(t, authedURL("/rest/star.view",
		"&id="+c.SAbbey1+"&albumId="+c.AlAbbey+"&artistId="+c.ArBeatles), nil)

	rec := app.get(t, authedURL("/rest/getStarred.view", ""), nil)
	env := assertOK(t, rec)
	starred, ok := env["starred"].(map[string]any)
	if !ok {
		t.Fatalf("missing starred key: %v", env)
	}
	songs := starred["song"].([]any)
	if len(songs) != 1 {
		t.Fatalf("starred songs = %d, want 1", len(songs))
	}
	song := songs[0].(map[string]any)
	if song["id"] != c.SAbbey1 {
		t.Fatalf("song id = %v", song["id"])
	}
	// The fabricated epoch star date (quirks doc X6).
	if song["starred"] != "1970-01-01T00:00:00.000Z" {
		t.Fatalf("starred = %v, want the epoch quirk", song["starred"])
	}
	if len(starred["album"].([]any)) != 1 || len(starred["artist"].([]any)) != 1 {
		t.Fatalf("starred album/artist missing: %v", starred)
	}

	// Unstar and the lists go empty (keys stay, arrays empty — the retired server shape).
	app.get(t, authedURL("/rest/unstar.view",
		"&id="+c.SAbbey1+"&albumId="+c.AlAbbey+"&artistId="+c.ArBeatles), nil)
	rec = app.get(t, authedURL("/rest/getStarred.view", ""), nil)
	env = assertOK(t, rec)
	starred = env["starred"].(map[string]any)
	if len(starred["song"].([]any)) != 0 || len(starred["album"].([]any)) != 0 ||
		len(starred["artist"].([]any)) != 0 {
		t.Fatalf("unstarred content still listed: %v", starred)
	}
}

func TestGetStarredScoped(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "") // the root admin comes from seedCatalog

	// Alice stars lib-a and lib-b content; her scope is lib-a only. The
	// admin stars the same set from their own account — getStarred lists
	// the CALLER's stars, so each user's scope applies to their own rows.
	app.get(t, authedURL("/rest/star.view",
		"&id="+c.SAbbey1+"&id="+c.SLow1+"&albumId="+c.AlAbbey+"&albumId="+c.AlLow+
			"&artistId="+c.ArBeatles+"&artistId="+c.ArBowie), nil)
	app.get(t, authedURLAs("root", "adminpass", "/rest/star.view",
		"&id="+c.SAbbey1+"&id="+c.SLow1+"&albumId="+c.AlAbbey+"&albumId="+c.AlLow+
			"&artistId="+c.ArBeatles+"&artistId="+c.ArBowie), nil)

	rec := app.get(t, authedURL("/rest/getStarred.view", ""), nil)
	env := assertOK(t, rec)
	starred := env["starred"].(map[string]any)
	if got := len(starred["song"].([]any)); got != 1 {
		t.Fatalf("scoped starred songs = %d, want 1 (lib-a only)", got)
	}
	if got := len(starred["album"].([]any)); got != 1 {
		t.Fatalf("scoped starred albums = %d, want 1", got)
	}
	if got := len(starred["artist"].([]any)); got != 1 {
		t.Fatalf("scoped starred artists = %d, want 1", got)
	}

	// The admin sees the full set (scope.All).
	rec = app.get(t, authedURLAs("root", "adminpass", "/rest/getStarred2.view", ""), nil)
	env = assertOK(t, rec)
	starred2 := env["starred2"].(map[string]any)
	if got := len(starred2["song"].([]any)); got != 2 {
		t.Fatalf("admin starred songs = %d, want 2", got)
	}
	if got := len(starred2["album"].([]any)); got != 2 {
		t.Fatalf("admin starred albums = %d, want 2", got)
	}
}

func TestGetStarredAndStarred2IdenticalPayloads(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.get(t, authedURL("/rest/star.view", "&id="+c.SAbbey1), nil)

	first := assertOK(t, app.get(t, authedURL("/rest/getStarred.view", ""), nil))["starred"]
	second := assertOK(t, app.get(t, authedURL("/rest/getStarred2.view", ""), nil))["starred2"]
	if fmt.Sprintf("%v", first) != fmt.Sprintf("%v", second) {
		t.Fatalf("getStarred and getStarred2 payloads differ:\n%v\n%v", first, second)
	}
}

func TestGetStarredXML(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.get(t, authedURL("/rest/star.view",
		"&id="+c.SAbbey1+"&albumId="+c.AlAbbey+"&artistId="+c.ArBeatles), nil)

	rec := app.get(t, authedURL("/rest/getStarred.view", "&f=xml"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d", rec.Code)
	}
	body := rec.Body.String()
	for _, check := range []string{
		`<starred>`,
		fmt.Sprintf(`<song id="%s"`, c.SAbbey1),
		`starred="1970-01-01T00:00:00.000Z"`,
		fmt.Sprintf(`<album id="%s"`, c.AlAbbey),
		fmt.Sprintf(`<artist id="%s"`, c.ArBeatles),
	} {
		if !strings.Contains(body, check) {
			t.Fatalf("getStarred XML missing %q:\n%s", check, body)
		}
	}

	// Empty lists produce no elements at all (quirks doc E7).
	rec = app.get(t, authedURL("/rest/getStarred2.view", "&f=xml"), nil)
	body = rec.Body.String()
	if strings.Contains(body, "<starred2/>") || !strings.Contains(body, "<starred2>") {
		t.Fatalf("empty starred2 must stay a present empty element:\n%s", body)
	}
}

// TestStarringAuthMatrix: the auth hook covers the new endpoints exactly
// like the rest of /rest (A1/A6: bad apiKey short-circuits 40, anonymous 10).
func TestStarringAuthMatrix(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedAPIKey(t, testAPIKey, testUserID)

	endpoints := []string{
		"/rest/star.view", "/rest/unstar.view", "/rest/setRating.view",
		"/rest/scrobble.view", "/rest/getStarred.view", "/rest/getStarred2.view",
	}
	for _, path := range endpoints {
		rec := app.get(t, path+"?apiKey="+wrongAPIKey, nil)
		assertFailed(t, rec, CodeUnauthorized)
		rec = app.get(t, path, nil)
		assertFailed(t, rec, CodeMissingParam)
	}
}
