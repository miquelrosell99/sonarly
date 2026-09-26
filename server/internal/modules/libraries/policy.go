// Package libraries hosts the libraries domain: the per-user library
// isolation policy — the security boundary ported from the old
// features/libraries/policy.ts: non-admin users only reach content in
// libraries assigned via user_libraries, admins see everything, and songs
// with a NULL library_id are hidden from non-admins — plus the admin CRUD
// and the user_libraries assignment endpoints (P9c, old
// features/libraries/admin-routes.ts). Content endpoints translate a false
// Is*InScope into 404, not 403, so out-of-scope ids cannot be probed.
package libraries

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Scope is a user's reachable library set.
type Scope struct {
	All bool
	IDs []string
}

// GetScope resolves the user's library scope: admins are unrestricted,
// everyone else is limited to their user_libraries assignments. An empty ID
// list means match-nothing, never match-everything, and so does an empty
// userID (unauthenticated callers).
func GetScope(ctx context.Context, q auth.Queries, userID string, isAdmin bool) (Scope, error) {
	if userID == "" {
		return Scope{IDs: []string{}}, nil
	}
	if isAdmin {
		return Scope{All: true}, nil
	}
	rows, err := q.QueryContext(ctx,
		`SELECT library_id FROM user_libraries WHERE user_id = ? ORDER BY library_id`, userID)
	if err != nil {
		return Scope{}, fmt.Errorf("load user libraries: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return Scope{}, fmt.Errorf("load user libraries: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return Scope{}, fmt.Errorf("load user libraries: %w", err)
	}
	return Scope{IDs: ids}, nil
}

// Condition is a parameterized SQL fragment: SQL plus the values to bind.
// Call sites splice it into a larger statement, never interpolate it.
type Condition struct {
	SQL    string
	Params []any
}

// ScopeCondition builds the parameterized `AND <column> IN (?, ...)` filter
// for a scope. column is a hardcoded identifier at call sites (e.g.
// "s.library_id"); only values are bound. Admins get an empty condition;
// an empty scope yields match-nothing ("AND 0"), never match-everything.
func ScopeCondition(scope Scope, column string) Condition {
	if scope.All {
		return Condition{}
	}
	if len(scope.IDs) == 0 {
		return Condition{SQL: "AND 0"}
	}
	placeholders := make([]string, len(scope.IDs))
	for i := range placeholders {
		placeholders[i] = "?"
	}
	params := make([]any, len(scope.IDs))
	for i, id := range scope.IDs {
		params[i] = id
	}
	return Condition{SQL: fmt.Sprintf("AND %s IN (%s)", column, strings.Join(placeholders, ", ")), Params: params}
}

// IsSongInScope reports whether the song is reachable under the scope. Like
// the retired server, it does not require the song to be active — inactive songs stay
// visible to whoever can reach the library (missing-file management).
func IsSongInScope(ctx context.Context, q auth.Queries, scope Scope, songID string) (bool, error) {
	if scope.All {
		return true, nil
	}
	c := ScopeCondition(scope, "s.library_id")
	var one int
	err := q.QueryRowContext(ctx,
		`SELECT 1 FROM songs s WHERE s.id = ? `+c.SQL+` LIMIT 1`,
		append([]any{songID}, c.Params...)...).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check song scope: %w", err)
	}
	return true, nil
}

// IsAlbumInScope reports whether any active song on the album is reachable.
// Call sites answer 404 when this is false.
func IsAlbumInScope(ctx context.Context, q auth.Queries, scope Scope, albumID string) (bool, error) {
	if scope.All {
		return true, nil
	}
	c := ScopeCondition(scope, "s.library_id")
	var one int
	err := q.QueryRowContext(ctx,
		`SELECT 1 FROM songs s WHERE s.album_id = ? AND s.active = 1 `+c.SQL+` LIMIT 1`,
		append([]any{albumID}, c.Params...)...).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check album scope: %w", err)
	}
	return true, nil
}

// IsArtistInScope reports whether any active song by the artist is reachable.
// Call sites answer 404 when this is false.
func IsArtistInScope(ctx context.Context, q auth.Queries, scope Scope, artistID string) (bool, error) {
	if scope.All {
		return true, nil
	}
	c := ScopeCondition(scope, "s.library_id")
	var one int
	err := q.QueryRowContext(ctx,
		`SELECT 1 FROM songs s WHERE s.artist_id = ? AND s.active = 1 `+c.SQL+` LIMIT 1`,
		append([]any{artistID}, c.Params...)...).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check artist scope: %w", err)
	}
	return true, nil
}

// IsCoverArtInScope reports whether the cover art belongs to a reachable
// active song — either its own art or its album's. Call sites answer 404
// when this is false.
func IsCoverArtInScope(ctx context.Context, q auth.Queries, scope Scope, coverArtID string) (bool, error) {
	if scope.All {
		return true, nil
	}
	c := ScopeCondition(scope, "s.library_id")
	var one int
	err := q.QueryRowContext(ctx,
		`SELECT 1 FROM songs s
		 LEFT JOIN albums al ON al.id = s.album_id
		 WHERE s.active = 1 AND (s.cover_art_id = ? OR al.cover_art_id = ?) `+c.SQL+` LIMIT 1`,
		append([]any{coverArtID, coverArtID}, c.Params...)...).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check cover art scope: %w", err)
	}
	return true, nil
}
