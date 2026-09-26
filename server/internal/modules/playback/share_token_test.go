package playback

import (
	"strings"
	"testing"
)

// seedSharePlaylists wires the P6 share-token scenarios over the standard
// playback fixture: a static link playlist whose membership deliberately
// spans libraries (legacy-curated data — the token path is scope-free by
// design), and a smart link playlist resolving against its owner's rules.
func (e *testEnv) seedSharePlaylists(t *testing.T) {
	t.Helper()
	exec := e.mustExec
	exec(t, `INSERT INTO playlists (id, name, owner_id, visibility, share_token, is_smart) VALUES
		('pl-static', 'StaticLink', 'user-alice', 'link', 'tok-static', 0),
		('pl-smart', 'SmartLink', 'user-alice', 'link', 'tok-smart', 1)`)
	exec(t, `UPDATE playlists SET rules_json = '{"rules":{"all":[{"field":"title","operator":"is","value":"Beta One"}]}}' WHERE id = 'pl-smart'`)
	exec(t, `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES
		('pl-static', 's-a1', 0), ('pl-static', 's-b1', 1)`)
	// Owner interaction data for the smart resolution.
	exec(t, `INSERT INTO user_songs (user_id, song_id, starred) VALUES ('user-alice', 's-b1', 0)`)
}

// TestStreamAnonymousShareToken: anonymous + valid token streams the linked
// playlist's songs — including songs outside every signed-in scope, which
// is exactly what link sharing is for (the old share semantics).
func TestStreamAnonymousShareToken(t *testing.T) {
	env := newEnv(t, Options{})
	env.seedSharePlaylists(t)

	res, body := env.do(t, "GET", "/api/stream/s-a1?share=tok-static", nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("anonymous token stream: want 200, got %d", res.StatusCode)
	}
	if string(body) != string(fileBytes(t, env.files["s-a1"])) {
		t.Error("streamed bytes != original file")
	}

	// s-b1 lives in lib-b: out of the owner's scope, but the token
	// authorizes the linked playlist's own content.
	res, body = env.do(t, "GET", "/api/stream/s-b1?share=tok-static", nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("scope-free token stream: want 200, got %d", res.StatusCode)
	}
	if string(body) != string(fileBytes(t, env.files["s-b1"])) {
		t.Error("streamed bytes != original file")
	}
}

// TestStreamShareTokenDenials: valid token + foreign song → 404 (the token
// grants only its own playlist's content); unknown token or none → 401.
func TestStreamShareTokenDenials(t *testing.T) {
	env := newEnv(t, Options{})
	env.seedSharePlaylists(t)

	cases := []struct {
		name   string
		path   string
		status int
	}{
		{"no token", "/api/stream/s-a1", 401},
		{"unknown token", "/api/stream/s-a1?share=nope", 401},
		{"valid token foreign song", "/api/stream/s-a2?share=tok-static", 404},
		{"valid token inactive song", "/api/stream/s-inactive?share=tok-static", 404},
		{"valid token NULL-library song", "/api/stream/s-nolib?share=tok-static", 404},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, _ := env.do(t, "GET", tc.path, nil, nil)
			if res.StatusCode != tc.status {
				t.Errorf("%s: want %d, got %d", tc.path, tc.status, res.StatusCode)
			}
		})
	}
}

// TestStreamShareTokenRevokedMidStream: regenerating or revoking the token
// kills access immediately (the policy reads the current row).
func TestStreamShareTokenRevokedMidStream(t *testing.T) {
	env := newEnv(t, Options{})
	env.seedSharePlaylists(t)

	res, _ := env.do(t, "GET", "/api/stream/s-a1?share=tok-static", nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("pre-revoke stream: %d", res.StatusCode)
	}
	// Owner rotates the token.
	env.mustExec(t, `UPDATE playlists SET share_token = 'tok-rotated' WHERE id = 'pl-static'`)
	res, _ = env.do(t, "GET", "/api/stream/s-a1?share=tok-static", nil, nil)
	if res.StatusCode != 401 {
		t.Errorf("rotated token: want 401, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/stream/s-a1?share=tok-rotated", nil, nil)
	if res.StatusCode != 200 {
		t.Errorf("new token: want 200, got %d", res.StatusCode)
	}
	// Revoke entirely: visibility away from link clears the token.
	env.mustExec(t, `UPDATE playlists SET visibility = 'private', share_token = NULL WHERE id = 'pl-static'`)
	res, _ = env.do(t, "GET", "/api/stream/s-a1?share=tok-rotated", nil, nil)
	if res.StatusCode != 401 {
		t.Errorf("revoked token: want 401, got %d", res.StatusCode)
	}
}

// TestStreamSmartShareToken: smart link playlists resolve against the
// OWNER's rules; the token grants exactly the resolved set.
func TestStreamSmartShareToken(t *testing.T) {
	env := newEnv(t, Options{})
	env.seedSharePlaylists(t)

	// pl-smart resolves title is "Beta One" → s-b1.
	res, body := env.do(t, "GET", "/api/stream/s-b1?share=tok-smart", nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("smart token stream: want 200, got %d", res.StatusCode)
	}
	if string(body) != string(fileBytes(t, env.files["s-b1"])) {
		t.Error("streamed bytes != original file")
	}
	// s-a1 is in the owner's library and streams fine with a session, but
	// the SMART token only grants its own resolution.
	res, _ = env.do(t, "GET", "/api/stream/s-a1?share=tok-smart", nil, nil)
	if res.StatusCode != 404 {
		t.Errorf("outside smart resolution: want 404, got %d", res.StatusCode)
	}
}

// TestStreamSmartShareTokenOwnerRules: a user-scoped rule resolves against
// the owner, not the anonymous viewer (who has no rows at all).
func TestStreamSmartShareTokenOwnerRules(t *testing.T) {
	env := newEnv(t, Options{})
	env.seedSharePlaylists(t)
	// Owner (user-alice) loves s-a2 only.
	env.mustExec(t, `INSERT INTO playlists (id, name, owner_id, visibility, share_token, is_smart, rules_json) VALUES
		('pl-loved', 'LovedLink', 'user-alice', 'link', 'tok-loved', 1,
		 '{"rules":{"all":[{"field":"loved","operator":"is","value":true}]}}')`)
	env.mustExec(t, `INSERT INTO user_songs (user_id, song_id, starred) VALUES
		('user-alice', 's-a2', 1), ('user-carol', 's-a1', 1)`)

	res, _ := env.do(t, "GET", "/api/stream/s-a2?share=tok-loved", nil, nil)
	if res.StatusCode != 200 {
		t.Errorf("owner-loved song: want 200, got %d", res.StatusCode)
	}
	// carol loves s-a1, but the rules resolve against the OWNER — denied.
	res, _ = env.do(t, "GET", "/api/stream/s-a1?share=tok-loved", nil, nil)
	if res.StatusCode != 404 {
		t.Errorf("non-owner-loved song: want 404, got %d", res.StatusCode)
	}
}

// TestStreamSignedInSessionWins: a signed-in caller is never gated by the
// token path — valid token, out-of-scope song, still 404 via the session
// scope check.
func TestStreamSignedInSessionWins(t *testing.T) {
	env := newEnv(t, Options{})
	env.seedSharePlaylists(t)
	alice := env.cookie(t, "user-alice", "alice", false)

	// In-scope: streams regardless of the token parameter.
	res, _ := env.do(t, "GET", "/api/stream/s-a1?share=tok-static", alice, nil)
	if res.StatusCode != 200 {
		t.Errorf("signed-in in-scope: want 200, got %d", res.StatusCode)
	}
	// Out-of-scope: the token cannot widen a session's reach.
	res, _ = env.do(t, "GET", "/api/stream/s-b1?share=tok-static", alice, nil)
	if res.StatusCode != 404 {
		t.Errorf("signed-in out-of-scope with token: want 404, got %d", res.StatusCode)
	}
	if !strings.Contains(res.Header.Get("Content-Type"), "application/json") {
		t.Errorf("error contract: %q", res.Header.Get("Content-Type"))
	}
}
