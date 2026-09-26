package playlists

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// maxSmartLimit caps a smart playlist's limit; a bigger requested limit is
// clamped rather than interpolated or rejected (the compiler always binds
// LIMIT as a parameter).
const maxSmartLimit = 5000

// Compiled is the result of compiling smart playlist rules: the id-listing
// query (with any resolved LIMIT bound as the final parameter) plus the
// count query used for limitPercent and list-view counts.
type Compiled struct {
	IDsSQL      string
	Params      []any
	CountSQL    string
	CountParams []any
	Limit       int // -1 when the query has no LIMIT clause
}

type fieldKind int

const (
	kindString fieldKind = iota
	kindNumber
	kindDate
	kindBoolean
)

// joinKeys name the optional joins a rule or sort clause needs.
const (
	joinAlbums      = "albums"
	joinArtist      = "artist"
	joinAlbumArtist = "albumArtist"
	joinUserSongs   = "userSongs"
)

type fieldSpec struct {
	kind       fieldKind
	expr       string // SQL expression; unused for genre (junction EXISTS)
	join       string // join key, "" when the column lives on songs
	userScoped bool   // resolves against the compiling user's row
}

// fieldWhitelist is THE field table (v1 compiler.ts fieldColumn, with the
// fixes: unknown fields are a 400 here instead of silently compiling
// against s.title, and genre is the song_genres junction so secondary
// genres match).
var fieldWhitelist = map[string]fieldSpec{
	"title":       {kind: kindString, expr: "s.title"},
	"album":       {kind: kindString, expr: "a.name", join: joinAlbums},
	"artist":      {kind: kindString, expr: "ar.name", join: joinArtist},
	"albumArtist": {kind: kindString, expr: "aar.name", join: joinAlbumArtist},
	"genre":       {kind: kindString, join: "genre"},
	"releaseType": {kind: kindString, expr: "a.release_type", join: joinAlbums},
	"year":        {kind: kindNumber, expr: "s.year"},
	"duration":    {kind: kindNumber, expr: "s.duration"},
	"bitDepth":    {kind: kindNumber, expr: "s.bits_per_sample"},
	"loved":       {kind: kindBoolean, expr: "COALESCE(us.starred, 0)", join: joinUserSongs, userScoped: true},
	"rating":      {kind: kindNumber, expr: "us.rating", join: joinUserSongs, userScoped: true},
	"playcount":   {kind: kindNumber, expr: "COALESCE(us.play_count, 0)", join: joinUserSongs, userScoped: true},
	"lastplayed":  {kind: kindDate, expr: "us.last_played", join: joinUserSongs, userScoped: true},
}

// operatorsByKind validates operator/field compatibility (v1 fell through
// to '1=1' for mismatches; v2 rejects them). isMissing/isPresent and
// inPlaylist/notInPlaylist are valid on any field.
var operatorsByKind = map[fieldKind]map[string]bool{
	kindString:  {"is": true, "isNot": true, "contains": true, "notContains": true, "startsWith": true, "endsWith": true},
	kindNumber:  {"is": true, "isNot": true, "gt": true, "gte": true, "lt": true, "lte": true, "inTheRange": true},
	kindDate:    {"before": true, "after": true, "inTheLast": true, "notInTheLast": true},
	kindBoolean: {"is": true, "isNot": true},
}

// genreExists matches a song when ANY of its genres (primary or secondary —
// the scanner populates song_genres for both) satisfies the inner
// predicate. Self-contained scalar subquery: no join-slot needed.
const genreExists = `EXISTS (SELECT 1 FROM song_genres sg JOIN genres g ON g.id = sg.genre_id WHERE sg.song_id = s.id AND %s)`

// genreSortExpr orders by the song's first junction genre (position order).
const genreSortExpr = `(SELECT g.name FROM song_genres sg JOIN genres g ON g.id = sg.genre_id WHERE sg.song_id = s.id ORDER BY sg.position LIMIT 1)`

type compileCtx struct {
	q      auth.Queries
	ctx    context.Context
	userID string
	params []any
	joins  map[string]bool
}

func (c *compileCtx) pushParam(v any) string {
	c.params = append(c.params, v)
	return "?"
}

func (c *compileCtx) ensureJoin(join string) {
	if join == "" {
		return
	}
	c.joins[join] = true
	if join == joinAlbumArtist {
		c.joins[joinAlbums] = true
	}
}

// Compile validates rules against the whitelists and compiles them into
// parameterized SQL. userID is the user the user-scoped fields (loved,
// rating, playcount, lastplayed) resolve against — the playlist owner for
// 'tracks' resolve mode, the viewer for 'query' — and the owner the
// inPlaylist rule verifies membership against (v1 fix: a rule may only
// reference the compiling user's own playlists). All rule values are bound
// parameters; LIKE metacharacters are escaped with ESCAPE '\'; LIMIT is
// always a bound parameter (limitPercent is resolved through the count
// query). Unknown fields/operators and bad values are *RulesError (400).
func Compile(ctx context.Context, q auth.Queries, rules *Rules, userID string) (*Compiled, error) {
	c := &compileCtx{q: q, ctx: ctx, userID: userID, joins: map[string]bool{}}
	where := "1=1"
	if rules != nil && rules.Group != nil && (len(rules.Group.All) > 0 || len(rules.Group.Any) > 0) {
		group, err := compileGroup(c, rules.Group)
		if err != nil {
			return nil, err
		}
		where = group
	}

	orderBy, err := compileSort(c, rules)
	if err != nil {
		return nil, err
	}
	joins := buildJoins(c.joins)

	// The user_songs join parameter binds before any WHERE parameter (join
	// clauses precede WHERE in the SQL text).
	var joinParams []any
	if c.joins[joinUserSongs] {
		joinParams = append(joinParams, userID)
	}
	whereParams := c.params
	activeWhere := "s.active = 1 AND " + where
	countSQL := `SELECT COUNT(DISTINCT s.id) FROM songs s ` + joins + ` WHERE ` + activeWhere

	limit, err := resolveLimit(c, rules, countSQL, append(append([]any{}, joinParams...), whereParams...))
	if err != nil {
		return nil, err
	}

	// ORDER BY precedes LIMIT; the limit is always a bound parameter.
	idsSQL := `SELECT DISTINCT s.id FROM songs s ` + joins + ` WHERE ` + activeWhere
	if orderBy != "" {
		idsSQL += ` ` + orderBy
	}
	params := append(append([]any{}, joinParams...), whereParams...)
	if limit >= 0 {
		idsSQL += ` LIMIT ?`
		params = append(params, limit)
	}
	return &Compiled{
		IDsSQL:      idsSQL,
		Params:      params,
		CountSQL:    countSQL,
		CountParams: append(append([]any{}, joinParams...), whereParams...),
		Limit:       limit,
	}, nil
}

// compileGroup ANDs the all-parts with the any-parts (v1 parity: single
// level, no nesting).
func compileGroup(c *compileCtx, g *RuleGroup) (string, error) {
	parts := []string{}
	if len(g.All) > 0 {
		all := make([]string, 0, len(g.All))
		for _, r := range g.All {
			s, err := compileRule(c, r)
			if err != nil {
				return "", err
			}
			all = append(all, s)
		}
		parts = append(parts, "("+strings.Join(all, " AND ")+")")
	}
	if len(g.Any) > 0 {
		any := make([]string, 0, len(g.Any))
		for _, r := range g.Any {
			s, err := compileRule(c, r)
			if err != nil {
				return "", err
			}
			any = append(any, s)
		}
		parts = append(parts, "("+strings.Join(any, " OR ")+")")
	}
	if len(parts) == 0 {
		return "1=1", nil
	}
	return strings.Join(parts, " AND "), nil
}

func compileRule(c *compileCtx, rule Rule) (string, error) {
	spec, ok := fieldWhitelist[rule.Field]
	if !ok {
		return "", rulesErrorf("unknown rule field %q", rule.Field)
	}
	c.ensureJoin(spec.join)

	switch rule.Operator {
	case "isMissing":
		if spec.userScoped {
			return fmt.Sprintf("(us.user_id IS NULL OR %s IS NULL)", spec.expr), nil
		}
		if spec.expr == "" { // genre junction: no genres at all
			return "NOT " + fmt.Sprintf(genreExists, "1=1"), nil
		}
		return spec.expr + " IS NULL", nil
	case "isPresent":
		if spec.userScoped {
			return fmt.Sprintf("(us.user_id IS NOT NULL AND %s IS NOT NULL)", spec.expr), nil
		}
		if spec.expr == "" {
			return fmt.Sprintf(genreExists, "1=1"), nil
		}
		return spec.expr + " IS NOT NULL", nil
	case "inPlaylist", "notInPlaylist":
		return compileInPlaylist(c, rule)
	}

	if !operatorsByKind[spec.kind][rule.Operator] {
		return "", rulesErrorf("operator %q is not valid for field %q", rule.Operator, rule.Field)
	}

	switch spec.kind {
	case kindString:
		return compileStringRule(c, rule, spec)
	case kindNumber:
		return compileNumberRule(c, rule, spec)
	case kindBoolean:
		return compileBooleanRule(c, rule, spec)
	case kindDate:
		return compileDateRule(c, rule, spec)
	}
	return "", rulesErrorf("unsupported field kind for %q", rule.Field)
}

// compileStringRule handles plain string fields and the genre junction.
// Junction semantics differ deliberately from v1's s.genre_id match: a
// negated match (isNot/notContains/isMissing) is true for songs carrying no
// genre at all — "no genre equals X" — instead of falling out through a
// LEFT JOIN NULL.
func compileStringRule(c *compileCtx, rule Rule, spec fieldSpec) (string, error) {
	raw, err := stringValue(rule.Value)
	if err != nil {
		return "", rulesErrorf("field %q: %v", rule.Field, err)
	}
	nocase := "COLLATE NOCASE"
	if spec.expr == "" { // genre: song_genres junction
		switch rule.Operator {
		case "is":
			p := c.pushParam(raw)
			return fmt.Sprintf(genreExists, "g.name = "+p+" "+nocase), nil
		case "isNot":
			p := c.pushParam(raw)
			return "NOT " + fmt.Sprintf(genreExists, "g.name = "+p+" "+nocase), nil
		case "contains", "startsWith", "endsWith":
			p := c.pushParam(likePattern(raw, rule.Operator))
			return fmt.Sprintf(genreExists, "g.name LIKE "+p+` ESCAPE '\' `+nocase), nil
		case "notContains":
			p := c.pushParam(likePattern(raw, rule.Operator))
			return "NOT " + fmt.Sprintf(genreExists, "g.name LIKE "+p+` ESCAPE '\' `+nocase), nil
		}
		return "", rulesErrorf("operator %q is not valid for field %q", rule.Operator, rule.Field)
	}

	switch rule.Operator {
	case "is":
		p := c.pushParam(raw)
		return fmt.Sprintf("%s = %s %s", spec.expr, p, nocase), nil
	case "isNot":
		p := c.pushParam(raw)
		return fmt.Sprintf("%s != %s %s", spec.expr, p, nocase), nil
	case "contains", "startsWith", "endsWith":
		p := c.pushParam(likePattern(raw, rule.Operator))
		return fmt.Sprintf("%s LIKE %s ESCAPE '\\' %s", spec.expr, p, nocase), nil
	case "notContains":
		p := c.pushParam(likePattern(raw, rule.Operator))
		return fmt.Sprintf("(%s IS NULL OR %s NOT LIKE %s ESCAPE '\\' %s)", spec.expr, spec.expr, p, nocase), nil
	}
	return "", rulesErrorf("operator %q is not valid for field %q", rule.Operator, rule.Field)
}

func compileNumberRule(c *compileCtx, rule Rule, spec fieldSpec) (string, error) {
	if rule.Operator == "inTheRange" {
		arr, ok := rule.Value.([]any)
		if !ok || len(arr) < 2 {
			return "", rulesErrorf("field %q with inTheRange requires a [min, max] pair", rule.Field)
		}
		lo, err := numberValue(arr[0])
		if err != nil {
			return "", rulesErrorf("field %q: %v", rule.Field, err)
		}
		hi, err := numberValue(arr[1])
		if err != nil {
			return "", rulesErrorf("field %q: %v", rule.Field, err)
		}
		minP := c.pushParam(lo)
		maxP := c.pushParam(hi)
		return fmt.Sprintf("%s BETWEEN %s AND %s", spec.expr, minP, maxP), nil
	}
	num, err := numberValue(rule.Value)
	if err != nil {
		return "", rulesErrorf("field %q: %v", rule.Field, err)
	}
	p := c.pushParam(num)
	switch rule.Operator {
	case "is":
		return fmt.Sprintf("%s = %s", spec.expr, p), nil
	case "isNot":
		return fmt.Sprintf("(%s IS NULL OR %s != %s)", spec.expr, spec.expr, p), nil
	case "gt":
		return fmt.Sprintf("%s > %s", spec.expr, p), nil
	case "gte":
		return fmt.Sprintf("%s >= %s", spec.expr, p), nil
	case "lt":
		return fmt.Sprintf("%s < %s", spec.expr, p), nil
	case "lte":
		return fmt.Sprintf("%s <= %s", spec.expr, p), nil
	}
	return "", rulesErrorf("operator %q is not valid for field %q", rule.Operator, rule.Field)
}

func compileBooleanRule(c *compileCtx, rule Rule, spec fieldSpec) (string, error) {
	want, err := boolValue(rule.Value)
	if err != nil {
		return "", rulesErrorf("field %q: %v", rule.Field, err)
	}
	v := 0
	if want {
		v = 1
	}
	p := c.pushParam(v)
	op := "="
	if rule.Operator == "isNot" {
		op = "!="
	}
	return fmt.Sprintf("%s %s %s", spec.expr, op, p), nil
}

func compileDateRule(c *compileCtx, rule Rule, spec fieldSpec) (string, error) {
	switch rule.Operator {
	case "inTheLast", "notInTheLast":
		days, err := daysValue(rule.Value)
		if err != nil {
			return "", rulesErrorf("field %q: %v", rule.Field, err)
		}
		// Bound parameter, never interpolated (v1 interpolated the digits
		// into the SQL text; the value is bound here).
		modifier := "-" + strconv.Itoa(days) + " days"
		p := c.pushParam(modifier)
		if rule.Operator == "inTheLast" {
			return fmt.Sprintf("datetime(%s) >= datetime('now', %s)", spec.expr, p), nil
		}
		return fmt.Sprintf("(%s IS NULL OR datetime(%s) < datetime('now', %s))", spec.expr, spec.expr, p), nil
	}
	iso, err := stringValue(rule.Value)
	if err != nil || iso == "" {
		return "", rulesErrorf("field %q with %s requires an ISO date string", rule.Field, rule.Operator)
	}
	p := c.pushParam(iso)
	op := ">"
	if rule.Operator == "before" {
		op = "<"
	}
	return fmt.Sprintf("datetime(%s) %s datetime(%s)", spec.expr, op, p), nil
}

// compileInPlaylist builds the inPlaylist EXISTS, verifying the referenced
// playlist exists and belongs to the compiling user (v1 accepted any id —
// a rule could leak foreign playlists' membership).
func compileInPlaylist(c *compileCtx, rule Rule) (string, error) {
	pid, err := stringValue(rule.Value)
	if err != nil || pid == "" {
		return "", rulesErrorf("%s requires a playlist id", rule.Operator)
	}
	var owner string
	err = c.q.QueryRowContext(c.ctx, `SELECT owner_id FROM playlists WHERE id = ?`, pid).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", rulesErrorf("%s references unknown playlist %q", rule.Operator, pid)
	}
	if err != nil {
		return "", fmt.Errorf("inPlaylist lookup: %w", err)
	}
	if owner != c.userID {
		return "", rulesErrorf("%s references playlist %q that does not belong to you", rule.Operator, pid)
	}
	p := c.pushParam(pid)
	subquery := fmt.Sprintf("EXISTS (SELECT 1 FROM playlist_songs ps WHERE ps.playlist_id = %s AND ps.song_id = s.id)", p)
	if rule.Operator == "notInPlaylist" {
		return "NOT " + subquery, nil
	}
	return subquery, nil
}

func compileSort(c *compileCtx, rules *Rules) (string, error) {
	if rules == nil || len(rules.Sort) == 0 {
		return "", nil
	}
	clauses := make([]string, 0, len(rules.Sort))
	for i, s := range rules.Sort {
		if s.Random {
			clauses = append(clauses, "RANDOM()")
			continue
		}
		spec, ok := fieldWhitelist[s.Field]
		if !ok {
			return "", rulesErrorf("unknown sort field %q", s.Field)
		}
		c.ensureJoin(spec.join)
		expr := spec.expr
		if s.Field == "genre" {
			expr = genreSortExpr
		}
		direction := "ASC"
		switch s.Direction {
		case "", "asc":
		case "desc":
			direction = "DESC"
		default:
			return "", rulesErrorf("sort[%d]: direction must be asc or desc", i)
		}
		clauses = append(clauses, fmt.Sprintf("%s %s", expr, direction))
	}
	return "ORDER BY " + strings.Join(clauses, ", "), nil
}

func buildJoins(joins map[string]bool) string {
	clauses := []string{}
	if joins[joinAlbums] {
		clauses = append(clauses, "LEFT JOIN albums a ON a.id = s.album_id")
	}
	if joins[joinArtist] {
		clauses = append(clauses, "LEFT JOIN artists ar ON ar.id = s.artist_id")
	}
	if joins[joinAlbumArtist] {
		clauses = append(clauses, "LEFT JOIN artists aar ON aar.id = a.artist_id")
	}
	if joins[joinUserSongs] {
		clauses = append(clauses, "LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?")
	}
	if len(clauses) == 0 {
		return ""
	}
	return strings.Join(clauses, " ") + " "
}

// resolveLimit applies limitPercent (via the count query) or limit
// (clamped to maxSmartLimit). A negative result means no LIMIT clause.
func resolveLimit(c *compileCtx, rules *Rules, countSQL string, countParams []any) (int, error) {
	if rules == nil {
		return -1, nil
	}
	if rules.LimitPercent != nil && *rules.LimitPercent > 0 {
		var total int
		if err := c.q.QueryRowContext(c.ctx, countSQL, countParams...).Scan(&total); err != nil {
			return -1, fmt.Errorf("smart playlist count: %w", err)
		}
		pct := min(*rules.LimitPercent, 100)
		return max(1, int(math.Ceil(float64(total)*float64(pct)/100))), nil
	}
	if rules.Limit != nil && *rules.Limit > 0 {
		return min(*rules.Limit, maxSmartLimit), nil
	}
	return -1, nil
}

// escapeLike prefixes LIKE metacharacters with the backslash escape char
// (v1 parity; the clauses carry ESCAPE '\').
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func likePattern(raw, operator string) string {
	escaped := escapeLike(raw)
	switch operator {
	case "contains", "notContains":
		return "%" + escaped + "%"
	case "startsWith":
		return escaped + "%"
	case "endsWith":
		return "%" + escaped
	default:
		return escaped
	}
}

func stringValue(v any) (string, error) {
	switch t := v.(type) {
	case string:
		return t, nil
	case int:
		return strconv.Itoa(t), nil
	case int64:
		return strconv.FormatInt(t, 10), nil
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64), nil
	case bool:
		return strconv.FormatBool(t), nil
	default:
		return "", fmt.Errorf("value must be a string, number, or boolean")
	}
}

func numberValue(v any) (float64, error) {
	switch t := v.(type) {
	case int:
		return float64(t), nil
	case int64:
		return float64(t), nil
	case float64:
		return t, nil
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return 0, fmt.Errorf("value %q is not a number", string(t))
		}
		return f, nil
	case string:
		f, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return 0, fmt.Errorf("value %q is not a number", t)
		}
		return f, nil
	default:
		return 0, fmt.Errorf("value must be a number")
	}
}

func boolValue(v any) (bool, error) {
	switch t := v.(type) {
	case bool:
		return t, nil
	case string:
		b, err := strconv.ParseBool(strings.ToLower(t))
		if err != nil {
			return false, fmt.Errorf("value %q is not a boolean", t)
		}
		return b, nil
	case float64:
		return t != 0, nil
	default:
		return false, fmt.Errorf("value must be a boolean")
	}
}

// daysValue mirrors v1's digit-stripping parse of inTheLast values
// ("7", "7 days", 7 → 7); anything without digits is 0 (match nothing
// recent / everything not-recent, per the operator).
func daysValue(v any) (int, error) {
	s, err := stringValue(v)
	if err != nil {
		return 0, err
	}
	digits := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) == 0 {
		return 0, nil
	}
	n, err := strconv.Atoi(string(digits))
	if err != nil {
		return 0, fmt.Errorf("value %q is not a day count", s)
	}
	return n, nil
}
