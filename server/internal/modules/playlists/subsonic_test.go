package playlists

import (
	"context"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// TestSubsonicListProjection pins the OpenSubsonic getPlaylists projection:
// the ONE-policy visibility set, name ordering, and v1's count/duration
// semantics (smart resolved count, duration = SUM over resolved ids without
// a liveness filter).
func TestSubsonicListProjection(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()

	owner := auth.Identity{UserID: "u-owner", Username: "owner"}
	items, err := env.svc.SubsonicList(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]SubsonicListItem{}
	for _, item := range items {
		byID[item.ID] = item
	}
	// Owned: private, public, link, shared-v, shared-e, smart. Foreign hidden.
	for _, id := range []string{"pl-private", "pl-public", "pl-link", "pl-shared-v", "pl-shared-e", "pl-smart"} {
		if _, ok := byID[id]; !ok {
			t.Fatalf("owner SubsonicList missing %s: %v", id, byID)
		}
	}
	if _, ok := byID["pl-foreign"]; ok {
		t.Fatal("foreign private playlist leaked into the owner's list")
	}

	// v1 count semantics: static → raw member count; duration → summed
	// seconds of the resolved ids.
	priv := byID["pl-private"]
	if priv.SongCount != 2 {
		t.Fatalf("pl-private count = %d, want 2", priv.SongCount)
	}
	if priv.Duration != 500 { // s-a1 300 + s-a2 200
		t.Fatalf("pl-private duration = %d, want 500", priv.Duration)
	}
	if priv.OwnerUsername != "owner" || priv.Visibility != "private" {
		t.Fatalf("pl-private meta = %+v", priv)
	}

	// Smart playlists report the resolved size through the same compiler
	// the native routes use (rules: title contains "a").
	smart := byID["pl-smart"]
	if smart.SongCount == 0 {
		t.Fatal("smart playlist resolved count must be positive")
	}

	// Name ordering (v1 getPlaylists ordered by name, not updated_at).
	for i := 1; i < len(items); i++ {
		if items[i-1].Name > items[i].Name {
			t.Fatalf("not ordered by name: %q then %q", items[i-1].Name, items[i].Name)
		}
	}

	// The viewer sees public + the two shares, nothing else.
	viewer := auth.Identity{UserID: "u-viewer", Username: "viewer"}
	items, err = env.svc.SubsonicList(ctx, viewer)
	if err != nil {
		t.Fatal(err)
	}
	byID = map[string]SubsonicListItem{}
	for _, item := range items {
		byID[item.ID] = item
	}
	for _, id := range []string{"pl-public", "pl-shared-v", "pl-shared-e"} {
		if _, ok := byID[id]; !ok {
			t.Fatalf("viewer SubsonicList missing %s: %v", id, byID)
		}
	}
	if _, ok := byID["pl-private"]; ok {
		t.Fatal("private playlist leaked to the viewer")
	}

	// A user with no relation sees only the public playlist.
	outsider := auth.Identity{UserID: "u-nolib", Username: "nolib"}
	items, err = env.svc.SubsonicList(ctx, outsider)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "pl-public" {
		t.Fatalf("outsider SubsonicList = %+v, want only pl-public", items)
	}
}

// TestSubsonicListSmartDuration: the smart playlist's duration resolves
// through the compiled ids like v1's resolvePlaylistSongDuration.
func TestSubsonicListSmartDuration(t *testing.T) {
	env := newEnv(t)
	ctx := context.Background()

	items, err := env.svc.SubsonicList(ctx, auth.Identity{UserID: "u-owner", Username: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID != "pl-smart" {
			continue
		}
		if item.Duration <= 0 {
			t.Fatalf("smart duration must sum the resolved ids, got %d", item.Duration)
		}
		return
	}
	t.Fatal("pl-smart missing")
}
