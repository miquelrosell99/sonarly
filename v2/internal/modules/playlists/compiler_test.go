package playlists

import (
	"context"
	"sort"
	"testing"
)

// compileIDs compiles rules and runs the id query, returning the result as
// a sorted set-compare-friendly slice.
func compileIDs(t *testing.T, env *testEnv, rules *Rules, userID string) []string {
	t.Helper()
	compiled, err := Compile(context.Background(), env.db, rules, userID)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	rows, err := env.db.Query(compiled.IDsSQL, compiled.Params...)
	if err != nil {
		t.Fatalf("run compiled: %v\n%s", err, compiled.IDsSQL)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Strings(ids)
	return ids
}

func compileErr(env *testEnv, rules *Rules, userID string) error {
	_, err := Compile(context.Background(), env.db, rules, userID)
	return err
}

func all(field, op string, value any) *Rules {
	return &Rules{Group: &RuleGroup{All: []Rule{{Field: field, Operator: op, Value: value}}}}
}

func assertIDs(t *testing.T, got []string, want ...string) {
	t.Helper()
	sort.Strings(want)
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// TestCompilerStringOperators covers every string operator on direct and
// joined string fields.
func TestCompilerStringOperators(t *testing.T) {
	env := newEnv(t)
	owner := "u-owner"

	assertIDs(t, compileIDs(t, env, all("title", "is", "Beta Song"), owner), "s-b1")
	assertIDs(t, compileIDs(t, env, all("title", "isNot", "Beta Song"), owner),
		"s-a1", "s-a2", "s-b2", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("title", "contains", "beta"), owner), "s-b1", "s-b2")
	assertIDs(t, compileIDs(t, env, all("title", "notContains", "beta"), owner),
		"s-a1", "s-a2", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("title", "startsWith", "100"), owner), "s-a1")
	assertIDs(t, compileIDs(t, env, all("title", "endsWith", "Song"), owner), "s-a2", "s-b1")
	assertIDs(t, compileIDs(t, env, all("album", "is", "A1"), owner), "s-a1", "s-a2")
	assertIDs(t, compileIDs(t, env, all("albumArtist", "is", "Alpha"), owner), "s-a1", "s-a2")
	assertIDs(t, compileIDs(t, env, all("artist", "contains", "bet"), owner), "s-b1", "s-b2")
	assertIDs(t, compileIDs(t, env, all("releaseType", "is", "single"), owner), "s-b1", "s-b2")
}

// TestCompilerLikeEscape: LIKE metacharacters in values match literally,
// never as wildcards.
func TestCompilerLikeEscape(t *testing.T) {
	env := newEnv(t)
	// s-a1 is the only title containing a literal percent.
	assertIDs(t, compileIDs(t, env, all("title", "contains", "%"), "u-owner"), "s-a1")
	assertIDs(t, compileIDs(t, env, all("title", "contains", "100% Pu"), "u-owner"), "s-a1")
	assertIDs(t, compileIDs(t, env, all("title", "is", "100% Pure"), "u-owner"), "s-a1")
}

// TestCompilerParameterizedValues: classic injection payloads as VALUES
// bind as data — zero extra rows, no error.
func TestCompilerParameterizedValues(t *testing.T) {
	env := newEnv(t)
	for _, op := range []string{"is", "contains", "startsWith"} {
		assertIDs(t, compileIDs(t, env, all("title", op, "' OR 1=1 --"), "u-owner"))
	}
	// The count query must be equally safe (limitPercent exercises it).
	rules := all("title", "contains", "' OR 1=1 --")
	rules.LimitPercent = pctPtr(50)
	assertIDs(t, compileIDs(t, env, rules, "u-owner"))
}

// TestCompilerGenreJunction: the genre rule matches the song_genres
// junction — a secondary genre (s-a1's Jazz, not songs.genre_id) matches.
func TestCompilerGenreJunction(t *testing.T) {
	env := newEnv(t)
	assertIDs(t, compileIDs(t, env, all("genre", "is", "Jazz"), "u-owner"), "s-a1", "s-b2")
	assertIDs(t, compileIDs(t, env, all("genre", "is", "Rock"), "u-owner"), "s-a1", "s-a2")
	assertIDs(t, compileIDs(t, env, all("genre", "contains", "azz"), "u-owner"), "s-a1", "s-b2")
	assertIDs(t, compileIDs(t, env, all("genre", "isNot", "Jazz"), "u-owner"),
		"s-a2", "s-b1", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("genre", "isMissing", nil), "u-owner"), "s-nolib")
	assertIDs(t, compileIDs(t, env, all("genre", "isPresent", nil), "u-owner"),
		"s-a1", "s-a2", "s-b1", "s-b2")
}

// TestCompilerNumberOperators: every number operator, including inTheRange.
func TestCompilerNumberOperators(t *testing.T) {
	env := newEnv(t)
	owner := "u-owner"
	assertIDs(t, compileIDs(t, env, all("year", "gt", 2000), owner), "s-a2", "s-b1", "s-b2")
	assertIDs(t, compileIDs(t, env, all("year", "gte", 2010), owner), "s-b1", "s-b2")
	assertIDs(t, compileIDs(t, env, all("year", "lt", 2000), owner), "s-a1", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("year", "lte", 1999), owner), "s-a1", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("year", "isNot", 1999), owner),
		"s-a2", "s-b1", "s-b2", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("year", "inTheRange", []any{2000, 2011}), owner),
		"s-a2", "s-b1", "s-b2")
	assertIDs(t, compileIDs(t, env, all("duration", "is", 300), owner), "s-a1")
	assertIDs(t, compileIDs(t, env, all("bitDepth", "gt", 16), owner), "s-b1", "s-b2")
	// String numbers coerce like v1's Number(value).
	assertIDs(t, compileIDs(t, env, all("year", "is", "2001"), owner), "s-a2")
}

// TestCompilerUserFields: loved/rating/playcount/lastplayed resolve against
// the compiling user's rows, with v1's NULL semantics.
func TestCompilerUserFields(t *testing.T) {
	env := newEnv(t)
	owner := "u-owner"

	assertIDs(t, compileIDs(t, env, all("loved", "is", true), owner), "s-a1")
	assertIDs(t, compileIDs(t, env, all("loved", "is", false), owner),
		"s-a2", "s-b1", "s-b2", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("rating", "gte", 4), owner), "s-a1")
	assertIDs(t, compileIDs(t, env, all("rating", "isMissing", nil), owner), "s-b1", "s-b2", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("rating", "isPresent", nil), owner), "s-a1", "s-a2")
	assertIDs(t, compileIDs(t, env, all("playcount", "gt", 5), owner), "s-a1")
	assertIDs(t, compileIDs(t, env, all("lastplayed", "inTheLast", 300), owner), "s-a1", "s-a2")
	assertIDs(t, compileIDs(t, env, all("lastplayed", "notInTheLast", 300), owner),
		"s-b1", "s-b2", "s-nolib")
	assertIDs(t, compileIDs(t, env, all("lastplayed", "before", "2026-06-01T00:00:00Z"), owner), "s-a2")
	assertIDs(t, compileIDs(t, env, all("lastplayed", "after", "2026-06-01T00:00:00Z"), owner), "s-a1")

	// A different user compiles against their own rows ('query' mode).
	assertIDs(t, compileIDs(t, env, all("loved", "is", true), "u-viewer"), "s-a2")
	assertIDs(t, compileIDs(t, env, all("rating", "gte", 4), "u-viewer"), "s-a2")
}

// TestCompilerInPlaylist: membership rules verify ownership of the
// referenced playlist (v1 accepted any id) and bind the id.
func TestCompilerInPlaylist(t *testing.T) {
	env := newEnv(t)
	owner := "u-owner"
	assertIDs(t, compileIDs(t, env, all("title", "inPlaylist", "pl-private"), owner),
		"s-a1", "s-a2")
	assertIDs(t, compileIDs(t, env, all("title", "notInPlaylist", "pl-private"), owner),
		"s-b1", "s-b2", "s-nolib")

	if err := compileErr(env, all("title", "inPlaylist", "pl-foreign"), owner); !IsRulesError(err) {
		t.Errorf("foreign playlist: want RulesError, got %v", err)
	}
	if err := compileErr(env, all("title", "inPlaylist", "pl-no-such"), owner); !IsRulesError(err) {
		t.Errorf("unknown playlist: want RulesError, got %v", err)
	}
	// The owner of the foreign playlist may reference it.
	assertIDs(t, compileIDs(t, env, all("title", "inPlaylist", "pl-foreign"), "u-outsider"), "s-b1")
}

// TestCompilerGroupsAndSort: all ANDed with any; ordering clauses.
func TestCompilerGroupsAndSort(t *testing.T) {
	env := newEnv(t)
	rules := &Rules{Group: &RuleGroup{
		All: []Rule{{Field: "genre", Operator: "is", Value: "Rock"}},
		Any: []Rule{{Field: "year", Operator: "is", Value: 1999}, {Field: "year", Operator: "is", Value: 2001}},
	}}
	assertIDs(t, compileIDs(t, env, rules, "u-owner"), "s-a1", "s-a2")

	// Sort by year descending: s-b2 (2011) must come first.
	sorted := &Rules{Group: &RuleGroup{All: []Rule{{Field: "genre", Operator: "is", Value: "Jazz"}}},
		Sort: []Sort{{Field: "year", Direction: "desc"}}}
	compiled, err := Compile(context.Background(), env.db, sorted, "u-owner")
	if err != nil {
		t.Fatal(err)
	}
	var first string
	if err := env.db.QueryRow(compiled.IDsSQL, compiled.Params...).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if first != "s-b2" {
		t.Errorf("year desc first = %s, want s-b2", first)
	}

	// Random sort compiles and returns every match.
	random := all("genre", "isPresent", nil)
	random.Sort = []Sort{{Random: true}}
	if got := compileIDs(t, env, random, "u-owner"); len(got) != 4 {
		t.Errorf("random sort: got %v", got)
	}

	// Bogus sort field/direction are 400s, not silent fallbacks.
	if err := compileErr(env, &Rules{Sort: []Sort{{Field: "bogus"}}}, "u-owner"); !IsRulesError(err) {
		t.Errorf("bogus sort field: got %v", err)
	}
	if err := compileErr(env, &Rules{Sort: []Sort{{Field: "year", Direction: "down"}}}, "u-owner"); !IsRulesError(err) {
		t.Errorf("bogus sort direction: got %v", err)
	}
}

// TestCompilerValidation: unknown fields and operators, wrong-kind
// operators, and malformed values are 400s (v1 silently compiled them
// against s.title).
func TestCompilerValidation(t *testing.T) {
	env := newEnv(t)
	owner := "u-owner"
	cases := []struct {
		name  string
		rules *Rules
	}{
		{"unknown field", all("bogus", "is", "x")},
		{"unknown operator", all("title", "bogus", "x")},
		{"string op on number field", all("year", "contains", "19")},
		{"number op on string field", all("title", "gt", 1)},
		{"date op on string field", all("title", "before", "2020-01-01")},
		{"inTheRange missing max", all("year", "inTheRange", []any{2000})},
		{"inTheRange non-numeric", all("year", "inTheRange", []any{"a", "b"})},
		{"is with no value", all("title", "is", nil)},
		{"contains with object value", &Rules{Group: &RuleGroup{All: []Rule{
			{Field: "title", Operator: "contains", Value: map[string]any{"x": 1}},
		}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := compileErr(env, tc.rules, owner); !IsRulesError(err) {
				t.Errorf("want RulesError, got %v", err)
			}
		})
	}
}

// TestCompilerLimits: LIMIT is always a bound parameter; huge limits clamp;
// limitPercent resolves through the count query.
func TestCompilerLimits(t *testing.T) {
	env := newEnv(t)
	owner := "u-owner"
	base := all("genre", "is", "Jazz") // {s-a1, s-b2}

	limited := *base
	limited.Limit = intPtr(1)
	compiled, err := Compile(context.Background(), env.db, &limited, owner)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Limit != 1 {
		t.Errorf("Limit = %d, want 1", compiled.Limit)
	}
	if ids := compileIDs(t, env, &limited, owner); len(ids) != 1 {
		t.Errorf("limit 1: got %v, want exactly 1 row", ids)
	}

	huge := *base
	huge.Limit = intPtr(1_000_000_000)
	compiled, err = Compile(context.Background(), env.db, &huge, owner)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Limit != maxSmartLimit {
		t.Errorf("huge limit must clamp to %d, got %d", maxSmartLimit, compiled.Limit)
	}

	// limitPercent: 50% of 2 → 1 row; 100% → 2 rows.
	pct := *base
	pct.LimitPercent = pctPtr(50)
	compiled, err = Compile(context.Background(), env.db, &pct, owner)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Limit != 1 {
		t.Errorf("limitPercent 50 of 2 = %d, want 1", compiled.Limit)
	}
	ids := compileIDs(t, env, &pct, owner)
	if len(ids) != 1 {
		t.Errorf("limitPercent 50: got %v, want 1 row", ids)
	}

	full := *base
	full.LimitPercent = pctPtr(100)
	ids = compileIDs(t, env, &full, owner)
	if len(ids) != 2 {
		t.Errorf("limitPercent 100: got %v, want 2 rows", ids)
	}
}

// TestCompilerEmptyRules: an empty/absent group matches every active song;
// inactive songs never match.
func TestCompilerEmptyRules(t *testing.T) {
	env := newEnv(t)
	assertIDs(t, compileIDs(t, env, &Rules{}, "u-owner"),
		"s-a1", "s-a2", "s-b1", "s-b2", "s-nolib")
	assertIDs(t, compileIDs(t, env, nil, "u-owner"),
		"s-a1", "s-a2", "s-b1", "s-b2", "s-nolib")
}

func pctPtr(v int) *int { return &v }
