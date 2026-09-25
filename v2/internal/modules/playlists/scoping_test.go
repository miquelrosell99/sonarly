package playlists

import (
	"context"
	"strings"
	"testing"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// TestScopingCrossLibraryPlaylist: a playlist whose members span libraries
// — the owner sees everything they curated, a same-library viewer sees only
// the in-scope subset, and an anonymous share-token viewer sees the linked
// playlist's own content regardless of library scope (v1 share semantics).
func TestScopingCrossLibraryPlaylist(t *testing.T) {
	env := newEnv(t)
	// Cross-library link playlist, deliberately unordered to catch ordering
	// bugs in the scope filter.
	env.mustExec(t, `INSERT INTO playlists (id, name, owner_id, visibility, share_token) VALUES
		('pl-link-x', 'LinkedX', 'u-owner', 'link', 'tok-x')`)
	env.mustExec(t, `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES
		('pl-link-x', 's-b1', 0), ('pl-link-x', 's-a2', 1), ('pl-link-x', 's-a1', 2)`)

	owner := ident("u-owner", false)
	viewer := ident("u-viewer", false)     // lib-a like the owner
	outsider := ident("u-outsider", false) // lib-b

	// Owner: everything, in curated order (scope exemption — the owner sees
	// the playlist as curated; only what they could add is in it anyway,
	// this playlist simulates legacy/admin-curated data).
	d, err := env.svc.Get(context.Background(), owner, "pl-link-x", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-b1,s-a2,s-a1" {
		t.Errorf("owner entries = %v, want curated order", got)
	}

	// Same-scope viewer WITHOUT the token: no access at all (visibility is
	// link) → 404 semantics.
	if _, err := env.svc.Get(context.Background(), viewer, "pl-link-x", ""); err != ErrNotFound {
		t.Errorf("viewer without token: want ErrNotFound, got %v", err)
	}

	// Anonymous with the token: full content, scope-free (the token
	// authorizes the linked playlist's own content — v1 /api/stream).
	d, err = env.svc.Get(context.Background(), auth.Identity{}, "pl-link-x", "tok-x")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-b1,s-a2,s-a1" {
		t.Errorf("anonymous token entries = %v, want full content in order", got)
	}

	// The public playlist filters for restricted viewers instead: [s-a1
	// (lib-a), s-b1 (lib-b)] — viewer sees only s-a1, outsider only s-b1.
	d, err = env.svc.Get(context.Background(), viewer, "pl-public", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-a1" {
		t.Errorf("viewer subset = %v, want [s-a1]", got)
	}
	d, err = env.svc.Get(context.Background(), outsider, "pl-public", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-b1" {
		t.Errorf("outsider subset = %v, want [s-b1]", got)
	}
	// Admin sees all.
	d, err = env.svc.Get(context.Background(), ident("u-admin", true), "pl-public", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); len(got) != 2 {
		t.Errorf("admin entries = %v, want both", got)
	}
	// Detail songCount describes the SHOWN entries.
	if d.SongCount != 2 {
		t.Errorf("admin songCount = %d", d.SongCount)
	}
}

// TestScopingResolveMode: 'tracks' resolves user-scoped rules against the
// owner for every viewer; 'query' resolves against the viewer.
func TestScopingResolveMode(t *testing.T) {
	env := newEnv(t)
	env.mustExec(t, `INSERT INTO playlists (id, name, owner_id, visibility, is_smart, rules_json, resolve_mode) VALUES
		('pl-q-mode', 'QueryMode', 'u-owner', 'public', 1,
		 '{"rules":{"all":[{"field":"rating","operator":"gte","value":4}]}}', 'query'),
		('pl-t-mode', 'TracksMode', 'u-owner', 'public', 1,
		 '{"rules":{"all":[{"field":"rating","operator":"gte","value":4}]}}', 'tracks')`)

	owner := ident("u-owner", false)
	viewer := ident("u-viewer", false)

	// 'tracks': both viewers receive the owner's curated list [s-a1].
	d, err := env.svc.Get(context.Background(), owner, "pl-t-mode", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-a1" {
		t.Errorf("tracks/owner = %v", got)
	}
	d, err = env.svc.Get(context.Background(), viewer, "pl-t-mode", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-a1" {
		t.Errorf("tracks/viewer must see the owner's list, got %v", got)
	}

	// 'query': each viewer re-resolves against their own data.
	d, err = env.svc.Get(context.Background(), owner, "pl-q-mode", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-a1" {
		t.Errorf("query/owner = %v", got)
	}
	d, err = env.svc.Get(context.Background(), viewer, "pl-q-mode", "")
	if err != nil {
		t.Fatal(err)
	}
	// Viewer rated s-a2=5 (and s-a1=1 → excluded).
	if got := entryIDs(*d); strings.Join(got, ",") != "s-a2" {
		t.Errorf("query/viewer = %v, want their own rated list [s-a2]", got)
	}
}

// TestScopingHideExplicit: the viewer's hide_explicit preference filters
// entries (and the shown count) without touching the playlist itself.
func TestScopingHideExplicit(t *testing.T) {
	env := newEnv(t)
	env.mustExec(t, `INSERT INTO songs (id, file_path, title, mtime, checksum, active, library_id, explicit) VALUES
		('s-exp', '/music/s-exp.flac', 'Explicit One', 1700000000000, 'k-exp', 1, 'lib-a', 1)`)
	env.mustExec(t, `INSERT INTO playlists (id, name, owner_id, visibility) VALUES
		('pl-exp', 'ExplicitMix', 'u-owner', 'public')`)
	env.mustExec(t, `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES
		('pl-exp', 's-a1', 0), ('pl-exp', 's-exp', 1)`)
	env.mustExec(t, `UPDATE users SET hide_explicit = 1 WHERE id = 'u-viewer'`)

	owner := ident("u-owner", false)
	viewer := ident("u-viewer", false)

	d, err := env.svc.Get(context.Background(), owner, "pl-exp", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-a1,s-exp" {
		t.Errorf("owner sees explicit content = %v", got)
	}
	d, err = env.svc.Get(context.Background(), viewer, "pl-exp", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := entryIDs(*d); strings.Join(got, ",") != "s-a1" {
		t.Errorf("hide_explicit viewer = %v, want [s-a1]", got)
	}
	if d.SongCount != 1 {
		t.Errorf("shown count = %d, want 1", d.SongCount)
	}
}

// TestListCounts: smart playlists resolve their count per viewer (query
// mode against the viewer), static playlists report raw membership.
func TestListCounts(t *testing.T) {
	env := newEnv(t)
	env.mustExec(t, `INSERT INTO playlists (id, name, owner_id, visibility, is_smart, rules_json, resolve_mode) VALUES
		('pl-q-count', 'QueryCount', 'u-owner', 'public', 1,
		 '{"rules":{"all":[{"field":"rating","operator":"gte","value":4}]}}', 'query')`)

	owner := env.cookie(t, "u-owner", "owner", false)
	viewer := env.cookie(t, "u-viewer", "viewer", false)

	_, body := env.do(t, "GET", "/api/playlists", owner, nil)
	for _, it := range decodeList(t, body) {
		switch it.ID {
		case "pl-q-count":
			if it.SongCount != 1 { // owner's rating: s-a1
				t.Errorf("owner smart count = %d, want 1", it.SongCount)
			}
		}
	}
	_, body = env.do(t, "GET", "/api/playlists", viewer, nil)
	for _, it := range decodeList(t, body) {
		if it.ID == "pl-q-count" && it.SongCount != 1 { // viewer's rating: s-a2
			t.Errorf("viewer smart count = %d, want 1 (their own resolution)", it.SongCount)
		}
	}
}
