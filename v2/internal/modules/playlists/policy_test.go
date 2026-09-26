package playlists

import (
	"context"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

func ident(userID string, admin bool) auth.Identity {
	return auth.Identity{UserID: userID, IsAdmin: admin}
}

func mustLoad(t *testing.T, env *testEnv, id string) *Playlist {
	t.Helper()
	p, err := GetByID(context.Background(), env.db, id)
	if err != nil {
		t.Fatalf("load %s: %v", id, err)
	}
	return p
}

func resolve(t *testing.T, env *testEnv, playlistID string, id auth.Identity, token string) Access {
	t.Helper()
	access, err := Resolve(context.Background(), env.db, mustLoad(t, env, playlistID), id, token)
	if err != nil {
		t.Fatalf("resolve %s: %v", playlistID, err)
	}
	return access
}

// TestResolveMatrix pins the ONE access policy: every visibility × identity
// × token combination and its exact access level.
func TestResolveMatrix(t *testing.T) {
	env := newEnv(t)
	cases := []struct {
		name       string
		playlistID string
		identity   auth.Identity
		token      string
		want       Access
	}{
		{"owner reaches own private", "pl-private", ident("u-owner", false), "", AccessOwner},
		{"owner wins over wrong token", "pl-link", ident("u-owner", false), "bogus", AccessOwner},
		{"public anonymous", "pl-public", ident("", false), "", AccessView},
		{"public stranger", "pl-public", ident("u-outsider", false), "", AccessView},
		{"public admin", "pl-public", ident("u-admin", true), "", AccessView},
		{"shared view grant", "pl-shared-v", ident("u-viewer", false), "", AccessView},
		{"shared edit grant", "pl-shared-e", ident("u-viewer", false), "", AccessEdit},
		{"share does not leak to outsider", "pl-shared-v", ident("u-outsider", false), "", AccessNone},
		{"link anonymous valid token", "pl-link", ident("", false), "tok-link", AccessView},
		{"link anonymous wrong token", "pl-link", ident("", false), "nope", AccessNone},
		{"link anonymous no token", "pl-link", ident("", false), "", AccessNone},
		{"link stranger valid token", "pl-link", ident("u-nolib", false), "tok-link", AccessView},
		{"link stranger wrong token", "pl-link", ident("u-nolib", false), "nope", AccessNone},
		{"private stranger", "pl-private", ident("u-viewer", false), "", AccessNone},
		{"private anonymous", "pl-private", ident("", false), "", AccessNone},
		{"private anonymous bogus token", "pl-private", ident("", false), "tok-link", AccessNone},
		{"admin is no playlist superuser", "pl-private", ident("u-admin", true), "", AccessNone},
		{"owner of foreign playlist", "pl-foreign", ident("u-outsider", false), "", AccessOwner},
		{"foreign playlist stranger", "pl-foreign", ident("u-owner", false), "", AccessNone},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolve(t, env, tc.playlistID, tc.identity, tc.token); got != tc.want {
				t.Errorf("Resolve(%s, %v, %q) = %s, want %s",
					tc.playlistID, tc.identity.UserID, tc.token, got, tc.want)
			}
		})
	}
}

// TestResolveExpiredVisibility: a playlist whose visibility moved away from
// link carries no token anymore (the ONE lifecycle rule), so even the old
// token grants nothing.
func TestResolveExpiredVisibility(t *testing.T) {
	env := newEnv(t)
	env.mustExec(t, `UPDATE playlists SET visibility = 'private', share_token = NULL WHERE id = 'pl-link'`)
	if got := resolve(t, env, "pl-link", ident("", false), "tok-link"); got != AccessNone {
		t.Errorf("expired link token: got %s, want none", got)
	}
}

// TestTokenGrantsSongScoping: a token grants only its own playlist's
// content — never another playlist's songs, even when both playlists share
// songs, and never inactive songs.
func TestTokenGrantsSongScoping(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()

	grants := func(token, song string) bool {
		t.Helper()
		ok, err := env.policy.TokenGrantsSong(ctx, env.db, token, song)
		if err != nil {
			t.Fatalf("TokenGrantsSong: %v", err)
		}
		return ok
	}

	if !grants("tok-link", "s-a1") {
		t.Error("tok-link must grant its own playlist's song s-a1")
	}
	if grants("tok-link", "s-a2") {
		t.Error("tok-link must NOT grant s-a2 (not in pl-link)")
	}
	if grants("tok-link", "s-b1") {
		t.Error("tok-link must NOT grant another playlist's song s-b1")
	}
	// s-a1 sits in pl-public too, but that is pl-link's own content — the
	// token grants it. What must never happen: a token granting a song that
	// is only reachable through a DIFFERENT playlist.
	env.mustExec(t, `INSERT INTO playlists (id, name, owner_id, visibility, share_token) VALUES
		('pl-link-b', 'LinkedB', 'u-outsider', 'link', 'tok-link-b')`)
	env.mustExec(t, `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES
		('pl-link-b', 's-b1', 0), ('pl-link-b', 's-a1', 1)`)
	if !grants("tok-link-b", "s-a1") {
		t.Error("shared song is in pl-link-b too; its token grants it")
	}
	if grants("tok-link-b", "s-a2") {
		t.Error("tok-link-b must NOT grant s-a2 (only in u-owner's playlists)")
	}
	if grants("bogus-token", "s-a1") {
		t.Error("unknown token grants nothing")
	}
}

// TestTokenGrantsSongSmart: smart link playlists resolve against the
// OWNER's rules (never the anonymous viewer's), and only their resolved
// songs are granted.
func TestTokenGrantsSongSmart(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()
	// pl-smart resolves (title contains "a") to {s-b1, s-b2} — all in
	// lib-b, outside the owner's library scope: the token path is
	// scope-free by design (v1 share semantics).
	granted := []string{"s-b1", "s-b2"}
	for _, song := range granted {
		ok, err := env.policy.TokenGrantsSong(ctx, env.db, "tok-smart", song)
		if err != nil {
			t.Fatalf("TokenGrantsSong: %v", err)
		}
		if !ok {
			t.Errorf("tok-smart must grant resolved song %s", song)
		}
	}
	for _, song := range []string{"s-a1", "s-a2"} {
		ok, err := env.policy.TokenGrantsSong(ctx, env.db, "tok-smart", song)
		if err != nil {
			t.Fatalf("TokenGrantsSong: %v", err)
		}
		if ok {
			t.Errorf("tok-smart must NOT grant %s (not in the owner's resolution)", song)
		}
	}
	// A user-scoped rule resolves against the OWNER's data: 'tracks' mode
	// means the anonymous viewer inherits the owner's curated list.
	env.mustExec(t, `INSERT INTO playlists (id, name, owner_id, visibility, share_token, is_smart, rules_json) VALUES
		('pl-smart-loved', 'SmartLoved', 'u-owner', 'link', 'tok-loved', 1,
		 '{"rules":{"all":[{"field":"loved","operator":"is","value":true}]}}')`)
	// Owner loves s-a1; u-viewer loves s-a2. The token grants s-a1 only.
	ok, err := env.policy.TokenGrantsSong(ctx, env.db, "tok-loved", "s-a1")
	if err != nil || !ok {
		t.Errorf("owner-loved song must be granted: granted=%v err=%v", ok, err)
	}
	ok, err = env.policy.TokenGrantsSong(ctx, env.db, "tok-loved", "s-a2")
	if err != nil || ok {
		t.Errorf("viewer-loved song must NOT be granted (owner rules): granted=%v err=%v", ok, err)
	}
}

// TestTokenGrantsCoverArt: art granted when it belongs to a granted song
// (its own art or its album's).
func TestTokenGrantsCoverArt(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()
	ok, err := env.policy.TokenGrantsCoverArt(ctx, env.db, "tok-link", "ca-sa1")
	if err != nil || !ok {
		t.Errorf("song's own art must be granted: %v %v", ok, err)
	}
	// pl-link only contains s-a1; ca-b1 belongs to s-b1's album — denied.
	ok, err = env.policy.TokenGrantsCoverArt(ctx, env.db, "tok-link", "ca-b1")
	if err != nil || ok {
		t.Errorf("foreign album art must NOT be granted: %v %v", ok, err)
	}
	// Smart: s-b1's album art is in the owner's resolution.
	ok, err = env.policy.TokenGrantsCoverArt(ctx, env.db, "tok-smart", "ca-b1")
	if err != nil || !ok {
		t.Errorf("smart resolution album art must be granted: %v %v", ok, err)
	}
}

// TestGrantCacheBounds: size cap evicts the oldest insertion; TTL expiry
// invalidates; a hit does not disturb insertion order.
func TestGrantCacheBounds(t *testing.T) {
	now := time.Now()
	c := newGrantCache(3, 30*time.Second, func() time.Time { return now })
	set := map[string]struct{}{"x": {}}

	c.set("a", set)
	c.set("b", set)
	c.set("c", set)
	if c.len() != 3 {
		t.Fatalf("len = %d, want 3", c.len())
	}
	c.set("d", set) // evicts "a" (oldest insertion)
	if c.len() != 3 {
		t.Fatalf("len after overflow = %d, want 3", c.len())
	}
	if _, ok := c.get("a"); ok {
		t.Error("oldest entry must be evicted first")
	}
	if _, ok := c.get("b"); !ok {
		t.Error("b must survive")
	}
	// Refreshing an existing key re-queues it at the back.
	c.set("b", set)
	c.set("e", set) // evicts "c" now, not the refreshed "b"
	if _, ok := c.get("c"); ok {
		t.Error("c must be evicted after b was refreshed")
	}
	if _, ok := c.get("b"); !ok {
		t.Error("refreshed b must survive")
	}
	// TTL expiry.
	now = now.Add(31 * time.Second)
	for _, key := range []string{"b", "d", "e"} {
		if _, ok := c.get(key); ok {
			t.Errorf("expired entry %s must miss", key)
		}
	}
	if c.len() != 0 {
		t.Errorf("expired entries must be dropped, len = %d", c.len())
	}
}
