package playback

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func postScrobble(t *testing.T, env *testEnv, path string, cookie *http.Cookie, body any) *http.Response {
	t.Helper()
	res, _ := env.do(t, "POST", path, cookie, body)
	return res
}

// TestScrobbleBadBodies: the 400 matrix (v1 B13 semantics).
func TestScrobbleBadBodies(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	cases := []struct {
		name string
		body string
	}{
		{"array body", `["not","an","object"]`},
		{"string body", `"hello"`},
		{"number body", `42`},
		{"completion wrong type", `{"completion":"high"}`},
		{"completion infinite", `{"completion":1e999}`},
		{"durationListened wrong type", `{"durationListened":"long"}`},
		{"durationListened NaN-ish", `{"durationListened":1e999}`},
		{"client wrong type", `{"client":42}`},
		{"source wrong type", `{"source":{}}`},
		{"playedAt wrong type", `{"playedAt":12345}`},
		{"playedAt unparseable", `{"playedAt":"not a date"}`},
		{"client over the length bound", fmt.Sprintf(`{"client":%q}`, strings.Repeat("c", maxScrobbleStringLen+1))},
		{"source over the length bound", fmt.Sprintf(`{"source":%q}`, strings.Repeat("s", maxScrobbleStringLen+1))},
		{"malformed json", `{"completion":`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := postScrobble(t, env, "/api/songs/s-a1/scrobble", alice, c.body)
			if res.StatusCode != 400 {
				t.Errorf("want 400, got %d", res.StatusCode)
			}
		})
	}

	var historyCount int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM listening_history`).Scan(&historyCount); err != nil {
		t.Fatal(err)
	}
	if historyCount != 0 {
		t.Errorf("bad bodies must not write history rows, got %d", historyCount)
	}
	var userSongsCount int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM user_songs`).Scan(&userSongsCount); err != nil {
		t.Fatal(err)
	}
	if userSongsCount != 0 {
		t.Errorf("bad bodies must not write user_songs rows, got %d", userSongsCount)
	}
}

// TestScrobbleClamps: out-of-range numbers are clamped, not rejected (v1 B13).
func TestScrobbleClamps(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	res := postScrobble(t, env, "/api/songs/s-a1/scrobble", alice,
		`{"completion":150,"durationListened":-3}`)
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	var completion float64
	var listened int
	if err := env.db.QueryRow(`SELECT completion, duration_listened FROM listening_history`).
		Scan(&completion, &listened); err != nil {
		t.Fatal(err)
	}
	if completion != 100 {
		t.Errorf("completion = %v, want clamped 100", completion)
	}
	if listened != 0 {
		t.Errorf("duration_listened = %v, want clamped 0", listened)
	}

	res = postScrobble(t, env, "/api/songs/s-a1/scrobble", alice, `{"completion":-5}`)
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	if err := env.db.QueryRow(`SELECT completion FROM listening_history ORDER BY rowid DESC LIMIT 1`).
		Scan(&completion); err != nil {
		t.Fatal(err)
	}
	if completion != 0 {
		t.Errorf("completion = %v, want clamped 0", completion)
	}
}

// TestScrobbleSuccess: upsert + history insert land together and increment.
func TestScrobbleSuccess(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	res := postScrobble(t, env, "/api/songs/s-a1/scrobble", alice,
		`{"completion":95,"durationListened":170,"playedAt":"2026-09-24T10:00:00.000Z","client":"web","source":"playlist"}`)
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	var playCount int
	var lastPlayed string
	if err := env.db.QueryRow(`SELECT play_count, last_played FROM user_songs WHERE user_id = 'user-alice' AND song_id = 's-a1'`).
		Scan(&playCount, &lastPlayed); err != nil {
		t.Fatal(err)
	}
	if playCount != 1 || lastPlayed == "" {
		t.Errorf("user_songs = {play_count:%d last_played:%q}, want {1 non-empty}", playCount, lastPlayed)
	}
	var playedAt, client, source string
	var completion float64
	var listened int
	if err := env.db.QueryRow(`SELECT played_at, duration_listened, completion, client, source
		FROM listening_history WHERE user_id = 'user-alice' AND song_id = 's-a1'`).
		Scan(&playedAt, &listened, &completion, &client, &source); err != nil {
		t.Fatal(err)
	}
	if playedAt != "2026-09-24T10:00:00.000Z" {
		t.Errorf("playedAt = %q, want the client-supplied value stored verbatim", playedAt)
	}
	if listened != 170 || completion != 95 || client != "web" || source != "playlist" {
		t.Errorf("history row = {%d %v %q %q}", listened, completion, client, source)
	}

	// A bare scrobble (empty body) is v1-valid: details default, play counts.
	res = postScrobble(t, env, "/api/songs/s-a1/scrobble", alice, nil)
	if res.StatusCode != 200 {
		t.Fatalf("empty body: status %d", res.StatusCode)
	}
	if err := env.db.QueryRow(`SELECT play_count FROM user_songs WHERE user_id = 'user-alice' AND song_id = 's-a1'`).
		Scan(&playCount); err != nil {
		t.Fatal(err)
	}
	if playCount != 2 {
		t.Errorf("play_count = %d, want 2", playCount)
	}
	var historyRows int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM listening_history`).Scan(&historyRows); err != nil {
		t.Fatal(err)
	}
	if historyRows != 2 {
		t.Errorf("history rows = %d, want 2", historyRows)
	}
	// The default playedAt is an ISO-8601 UTC timestamp.
	if err := env.db.QueryRow(`SELECT played_at FROM listening_history ORDER BY played_at DESC LIMIT 1`).
		Scan(&playedAt); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(playedAt, "Z") || !strings.Contains(playedAt, "T") {
		t.Errorf("default playedAt = %q, want ISO-8601", playedAt)
	}
	// Scrobbles are per-user: nobody else's rows were touched.
	var otherUsers int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM user_songs WHERE user_id != 'user-alice'`).
		Scan(&otherUsers); err != nil {
		t.Fatal(err)
	}
	if otherUsers != 0 {
		t.Errorf("other users' user_songs rows = %d, want 0", otherUsers)
	}
}

// TestScrobbleTransactionIsAtomic: forcing the history insert to fail (PK
// collision on the injected id) must roll the user_songs upsert back too —
// both or neither.
func TestScrobbleTransactionIsAtomic(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	orig := newHistoryID
	t.Cleanup(func() { newHistoryID = orig })
	newHistoryID = func() string { return "fixed-id" }
	// Pre-insert a history row with the colliding id for another user.
	env.mustExec(t, `INSERT INTO listening_history (id, user_id, song_id)
		VALUES ('fixed-id', 'user-bob', 's-a1')`)

	res := postScrobble(t, env, "/api/songs/s-a1/scrobble", alice, `{"completion":50}`)
	if res.StatusCode != 500 {
		t.Fatalf("forced collision: want 500, got %d", res.StatusCode)
	}
	var playCount int
	err := env.db.QueryRow(`SELECT play_count FROM user_songs WHERE user_id = 'user-alice' AND song_id = 's-a1'`).
		Scan(&playCount)
	if err == nil {
		t.Errorf("user_songs row survived the rollback: play_count=%d", playCount)
	}
	var historyRows int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM listening_history`).Scan(&historyRows); err != nil {
		t.Fatal(err)
	}
	if historyRows != 1 {
		t.Errorf("history rows = %d, want only the pre-inserted one", historyRows)
	}
}

// TestScrobbleGuards: liveness, scope, and auth.
func TestScrobbleGuards(t *testing.T) {
	env := newEnv(t, Options{})
	cookies := map[string]*http.Cookie{
		"admin": env.cookie(t, "user-admin", "root", true),
		"alice": env.cookie(t, "user-alice", "alice", false),
		"carol": env.cookie(t, "user-carol", "carol", false),
	}
	cases := []struct {
		name   string
		user   string
		songID string
		want   int
	}{
		{"anon", "", "s-a1", 401},
		{"unknown song", "alice", "nope", 404},
		{"inactive song", "alice", "s-inactive", 404},
		{"out of scope", "alice", "s-b1", 404},
		{"admin in scope", "admin", "s-a1", 200},
		{"admin foreign library", "admin", "s-b1", 200},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			path := fmt.Sprintf("/api/songs/%s/scrobble", c.songID)
			var res *http.Response
			if c.user == "" {
				res, _ = env.do(t, "POST", path, nil, `{}`)
			} else {
				res = postScrobble(t, env, path, cookies[c.user], `{}`)
			}
			if res.StatusCode != c.want {
				t.Errorf("want %d, got %d", c.want, res.StatusCode)
			}
		})
	}
}

// TestScrobbleBodyIsAnObjectButNotAnObject: guard the JSON decode contract
// (top-level non-objects 400 through the same path as v1).
func TestScrobblePlayedAtFormats(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)
	for _, at := range []string{
		"2026-09-24T10:00:00.000Z",
		"2026-09-24",
		"Wed, 24 Sep 2026 10:00:00 GMT",
	} {
		res := postScrobble(t, env, "/api/songs/s-a2/scrobble", alice,
			fmt.Sprintf(`{"playedAt":%q}`, at))
		if res.StatusCode != 200 {
			t.Errorf("playedAt %q: want 200, got %d", at, res.StatusCode)
		}
	}
	var historyRows int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM listening_history`).Scan(&historyRows); err != nil {
		t.Fatal(err)
	}
	if historyRows != 3 {
		t.Errorf("history rows = %d, want 3", historyRows)
	}
}
