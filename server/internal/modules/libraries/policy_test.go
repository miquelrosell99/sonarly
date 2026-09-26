package libraries_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// Fixture: two libraries, four songs across two artists/albums, one song
// outside any library, one inactive song — enough to probe every scope rule.
//
//	libs:    lib-a, lib-b
//	artists: artist-1 (album-1), artist-2 (album-2), artist-3 (album-3, inactive only)
//	songs:   s1 lib-a active  album-1 artist-1 cover ca-song
//	         s2 lib-b active  album-2 artist-2 cover ca-song2
//	         s3 lib-a INACTIVE album-1 artist-1
//	         s4 NULL  active  album-1 artist-1
//	         s5 lib-a INACTIVE album-3 artist-3
//	covers:  ca-album (album-1), ca-song (s1), ca-song2 (s2), ca-orphan (unused)

type fixture struct {
	db *sql.DB
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.Exec(query, args...); err != nil {
			t.Fatalf("fixture: %v\n%s", err, query)
		}
	}

	mustExec(`INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', '/music/a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
		('lib-b', 'Library B', '/music/b', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)

	mustExec(`INSERT INTO users (id, username, password_hash, is_admin) VALUES
		('admin-user', 'root', 'x', 1),
		('user-a', 'alice', 'x', 0),
		('user-none', 'bob', 'x', 0)`)
	mustExec(`INSERT INTO user_libraries (user_id, library_id) VALUES ('user-a', 'lib-a')`)

	mustExec(`INSERT INTO artists (id, name) VALUES
		('artist-1', 'Alpha'), ('artist-2', 'Beta'), ('artist-3', 'Gamma')`)
	mustExec(`INSERT INTO albums (id, name, artist_id) VALUES
		('album-1', 'A1', 'artist-1'), ('album-2', 'A2', 'artist-2'), ('album-3', 'A3', 'artist-3')`)
	mustExec(`INSERT INTO cover_arts (id, format, data, hash) VALUES
		('ca-album', 'jpg', x'00', 'h-album'), ('ca-song', 'jpg', x'00', 'h-song'),
		('ca-song2', 'jpg', x'00', 'h-song2'), ('ca-orphan', 'jpg', x'00', 'h-orphan')`)
	mustExec(`UPDATE albums SET cover_art_id = 'ca-album' WHERE id = 'album-1'`)

	mustExec(`INSERT INTO songs (id, file_path, title, mtime, checksum, artist_id, album_id, active, library_id, cover_art_id) VALUES
		('s1', '/music/a/1.flac', 'One',   1, 'c1', 'artist-1', 'album-1', 1, 'lib-a', 'ca-song'),
		('s2', '/music/b/2.flac', 'Two',   1, 'c2', 'artist-2', 'album-2', 1, 'lib-b', 'ca-song2'),
		('s3', '/music/a/3.flac', 'Three', 1, 'c3', 'artist-1', 'album-1', 0, 'lib-a', NULL),
		('s4', '/music/x/4.flac', 'Four',  1, 'c4', 'artist-1', 'album-1', 1, NULL,    NULL),
		('s5', '/music/a/5.flac', 'Five',  1, 'c5', 'artist-3', 'album-3', 0, 'lib-a', NULL)`)

	return &fixture{db: database}
}

func (f *fixture) scope(t *testing.T, userID string, isAdmin bool) libraries.Scope {
	t.Helper()
	scope, err := libraries.GetScope(context.Background(), f.db, userID, isAdmin)
	if err != nil {
		t.Fatalf("get scope: %v", err)
	}
	return scope
}

func TestGetScope(t *testing.T) {
	f := newFixture(t)

	admin := f.scope(t, "admin-user", true)
	if !admin.All {
		t.Error("admin must be unrestricted")
	}

	assigned := f.scope(t, "user-a", false)
	if assigned.All || len(assigned.IDs) != 1 || assigned.IDs[0] != "lib-a" {
		t.Errorf("assigned user: %+v", assigned)
	}

	unassigned := f.scope(t, "user-none", false)
	if unassigned.All || len(unassigned.IDs) != 0 {
		t.Errorf("unassigned user must get an empty (match-nothing) scope: %+v", unassigned)
	}

	anonymous := f.scope(t, "", false)
	if anonymous.All || len(anonymous.IDs) != 0 {
		t.Errorf("empty user id must get a match-nothing scope: %+v", anonymous)
	}
}

func TestScopeConditionFragments(t *testing.T) {
	admin := libraries.ScopeCondition(libraries.Scope{All: true}, "s.library_id")
	if admin.SQL != "" || len(admin.Params) != 0 {
		t.Errorf("admin scope must add no condition: %+v", admin)
	}

	empty := libraries.ScopeCondition(libraries.Scope{IDs: []string{}}, "s.library_id")
	if empty.SQL != "AND 0" || len(empty.Params) != 0 {
		t.Errorf("empty scope must match nothing: %+v", empty)
	}

	one := libraries.ScopeCondition(libraries.Scope{IDs: []string{"lib-a"}}, "s.library_id")
	if one.SQL != "AND s.library_id IN (?)" || len(one.Params) != 1 || one.Params[0] != "lib-a" {
		t.Errorf("single id: %+v", one)
	}

	two := libraries.ScopeCondition(libraries.Scope{IDs: []string{"lib-a", "lib-b"}}, "al.library_id")
	if two.SQL != "AND al.library_id IN (?, ?)" || len(two.Params) != 2 {
		t.Errorf("two ids: %+v", two)
	}
}

// TestEmptyScopeNeverMatchesEverything executes the empty-scope fragment
// against real rows: the paranoid case from the retired server audit.
func TestEmptyScopeNeverMatchesEverything(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	for _, column := range []string{"s.library_id"} {
		cond := libraries.ScopeCondition(libraries.Scope{IDs: []string{}}, column)
		var n int
		if err := f.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM songs s WHERE 1 = 1 `+cond.SQL).Scan(&n); err != nil {
			t.Fatalf("empty scope query: %v", err)
		}
		if n != 0 {
			t.Fatalf("empty scope matched %d songs", n)
		}
	}

	// Sanity: the same query shape with a real scope does match.
	assigned := f.scope(t, "user-a", false)
	cond := libraries.ScopeCondition(assigned, "s.library_id")
	var n int
	if err := f.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM songs s WHERE 1 = 1 `+cond.SQL, cond.Params...).Scan(&n); err != nil {
		t.Fatalf("scoped query: %v", err)
	}
	if n != 3 { // s1, s3, s5 are in lib-a; s4's NULL library_id hides it
		t.Fatalf("scoped count: want 3, got %d", n)
	}
}

func TestIsSongInScope(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	cases := []struct {
		name    string
		userID  string
		isAdmin bool
		song    string
		want    bool
	}{
		{"admin reaches everything", "admin-user", true, "s2", true},
		{"admin sees null-library song", "admin-user", true, "s4", true},
		{"assigned user in scope", "user-a", false, "s1", true},
		{"assigned user out of scope", "user-a", false, "s2", false},
		// NULL library_id songs are hidden from non-admins.
		{"assigned user null-library song", "user-a", false, "s4", false},
		{"unassigned user nothing", "user-none", false, "s1", false},
		// Inactive songs stay visible to whoever reaches the library (wire parity).
		{"inactive song still in scope", "user-a", false, "s3", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scope := f.scope(t, tc.userID, tc.isAdmin)
			got, err := libraries.IsSongInScope(ctx, f.db, scope, tc.song)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("IsSongInScope(%s): want %v, got %v", tc.song, tc.want, got)
			}
		})
	}
}

func TestIsAlbumInScope(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	cases := []struct {
		name    string
		userID  string
		isAdmin bool
		album   string
		want    bool
	}{
		{"admin album", "admin-user", true, "album-2", true},
		{"user album via active song", "user-a", false, "album-1", true},
		{"user album out of scope", "user-a", false, "album-2", false},
		// album-3 has only an inactive song: not reachable.
		{"inactive-only album hidden", "user-a", false, "album-3", false},
		{"unassigned nothing", "user-none", false, "album-1", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scope := f.scope(t, tc.userID, tc.isAdmin)
			got, err := libraries.IsAlbumInScope(ctx, f.db, scope, tc.album)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("IsAlbumInScope(%s): want %v, got %v", tc.album, tc.want, got)
			}
		})
	}
}

func TestIsArtistInScope(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	cases := []struct {
		name    string
		userID  string
		isAdmin bool
		artist  string
		want    bool
	}{
		{"admin artist", "admin-user", true, "artist-2", true},
		{"user artist via active song", "user-a", false, "artist-1", true},
		{"user artist out of scope", "user-a", false, "artist-2", false},
		{"inactive-only artist hidden", "user-a", false, "artist-3", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scope := f.scope(t, tc.userID, tc.isAdmin)
			got, err := libraries.IsArtistInScope(ctx, f.db, scope, tc.artist)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("IsArtistInScope(%s): want %v, got %v", tc.artist, tc.want, got)
			}
		})
	}
}

func TestIsCoverArtInScope(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	cases := []struct {
		name     string
		userID   string
		isAdmin  bool
		coverArt string
		want     bool
	}{
		{"admin cover", "admin-user", true, "ca-orphan", true},
		{"song cover in scope", "user-a", false, "ca-song", true},
		{"album cover in scope via join", "user-a", false, "ca-album", true},
		{"song cover out of scope", "user-a", false, "ca-song2", false},
		{"orphan cover hidden", "user-a", false, "ca-orphan", false},
		{"unassigned nothing", "user-none", false, "ca-album", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scope := f.scope(t, tc.userID, tc.isAdmin)
			got, err := libraries.IsCoverArtInScope(ctx, f.db, scope, tc.coverArt)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("IsCoverArtInScope(%s): want %v, got %v", tc.coverArt, tc.want, got)
			}
		})
	}
}
