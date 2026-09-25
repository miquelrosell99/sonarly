package playlists

import (
	"context"
	"strings"
	"testing"
)

func memberRows(t *testing.T, env *testEnv, playlistID string) []string {
	t.Helper()
	ids, err := SongIDs(context.Background(), env.db, playlistID)
	if err != nil {
		t.Fatalf("song ids: %v", err)
	}
	return ids
}

// TestCreateTransactional: a member insert failure (FK violation) rolls the
// whole create back — no playlist row, no members.
func TestCreateTransactional(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()

	p := &Playlist{ID: "pl-new", Name: "New", OwnerID: "u-owner", Visibility: "private"}
	err := Create(ctx, env.db, p, []string{"s-a1", "no-such-song"})
	if err == nil {
		t.Fatal("expected FK failure")
	}
	if _, err := GetByID(ctx, env.db, "pl-new"); err != ErrNotFound {
		t.Errorf("playlist row must roll back, got %v", err)
	}
}

// TestCreateOrdersMembers: positions follow the request order.
func TestCreateOrdersMembers(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()
	p := &Playlist{ID: "pl-ordered", Name: "Ordered", OwnerID: "u-owner", Visibility: "private"}
	if err := Create(ctx, env.db, p, []string{"s-a2", "s-a1", "s-a2"}); err != nil {
		t.Fatal(err)
	}
	ids := memberRows(t, env, "pl-ordered")
	if strings.Join(ids, ",") != "s-a2,s-a1" {
		t.Errorf("members = %v, want [s-a2 s-a1] (deduped, ordered)", ids)
	}
}

// TestUpdateTransactionalRewrite: a failed member rewrite leaves the
// original membership untouched (v1 B3 fix — one tx).
func TestUpdateTransactionalRewrite(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()

	p := mustLoad(t, env, "pl-private")
	updated := *p
	updated.Name = "Renamed"
	err := Update(ctx, env.db, &updated, []string{"s-b1", "no-such-song"}, true)
	if err == nil {
		t.Fatal("expected FK failure on member rewrite")
	}
	reloaded := mustLoad(t, env, "pl-private")
	if reloaded.Name != "Private" {
		t.Errorf("name = %q, want untouched 'Private'", reloaded.Name)
	}
	if ids := memberRows(t, env, "pl-private"); strings.Join(ids, ",") != "s-a1,s-a2" {
		t.Errorf("members = %v, want original [s-a1 s-a2]", ids)
	}
}

// TestUpdateClearsSmartMembers: updating to smart clears stale member rows.
func TestUpdateClearsSmartMembers(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()
	p := mustLoad(t, env, "pl-private")
	p.IsSmart = true
	p.Rules = &Rules{Group: &RuleGroup{All: []Rule{{Field: "title", Operator: "is", Value: "Beta Song"}}}}
	if err := Update(ctx, env.db, p, nil, true); err != nil {
		t.Fatal(err)
	}
	if ids := memberRows(t, env, "pl-private"); len(ids) != 0 {
		t.Errorf("smart playlist must carry no members, got %v", ids)
	}
}

// TestShareLifecycle: upsert (with can_edit flip) and delete.
func TestShareLifecycle(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()

	if err := ShareUpsert(ctx, env.db, "pl-private", "u-outsider", false); err != nil {
		t.Fatal(err)
	}
	entries, err := ShareEntries(ctx, env.db, "pl-private")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].UserID != "u-outsider" || entries[0].CanEdit {
		t.Fatalf("entries = %+v", entries)
	}
	// Upsert flips can_edit.
	if err := ShareUpsert(ctx, env.db, "pl-private", "u-outsider", true); err != nil {
		t.Fatal(err)
	}
	entries, _ = ShareEntries(ctx, env.db, "pl-private")
	if !entries[0].CanEdit {
		t.Error("can_edit flip lost")
	}
	if err := ShareDelete(ctx, env.db, "pl-private", "u-outsider"); err != nil {
		t.Fatal(err)
	}
	entries, _ = ShareEntries(ctx, env.db, "pl-private")
	if len(entries) != 0 {
		t.Errorf("share must be revoked, got %+v", entries)
	}
}

// TestShareLinkLifecycle: enable pins visibility=link with the token;
// disable returns to private and clears it (token exists iff link).
func TestShareLinkLifecycle(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()

	if err := EnableShareLink(ctx, env.db, "pl-private", "tok-1"); err != nil {
		t.Fatal(err)
	}
	p := mustLoad(t, env, "pl-private")
	if p.Visibility != "link" || p.ShareToken != "tok-1" {
		t.Errorf("after enable: %s %q", p.Visibility, p.ShareToken)
	}
	if err := DisableShareLink(ctx, env.db, "pl-private"); err != nil {
		t.Fatal(err)
	}
	p = mustLoad(t, env, "pl-private")
	if p.Visibility != "private" || p.ShareToken != "" {
		t.Errorf("after disable: %s %q, want private with no token", p.Visibility, p.ShareToken)
	}
}

// TestMintShareToken: 32 random bytes hex-encoded, unique per mint.
func TestMintShareToken(t *testing.T) {
	a, err := MintShareToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := MintShareToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 64 {
		t.Errorf("token length = %d, want 64 hex chars", len(a))
	}
	if a == b {
		t.Error("tokens must be unique")
	}
}
