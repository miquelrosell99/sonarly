package catalog

import (
	"context"
	"fmt"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
)

// listYears returns the distinct years of active in-scope songs AND albums
// as bare values, newest first — v1's exact contract (the web client maps
// the array directly).
func listYears(ctx context.Context, q auth.Queries, scope libraries.Scope) ([]int, error) {
	scopeCond := libraries.ScopeCondition(scope, "library_id")
	songScopeCond := libraries.ScopeCondition(scope, "s.library_id")
	albumScope := ""
	albumArgs := []any{}
	if !scope.All {
		albumScope = ` AND EXISTS (SELECT 1 FROM songs s WHERE s.album_id = albums.id AND s.active = 1 ` + songScopeCond.SQL + `)`
		albumArgs = append(albumArgs, songScopeCond.Params...)
	}
	args := append([]any{}, scopeCond.Params...)
	args = append(args, albumArgs...)
	args = append(args, scopeCond.Params...)
	rows, err := q.QueryContext(ctx,
		`SELECT value FROM (
			SELECT year AS value FROM songs WHERE active = 1 AND year IS NOT NULL `+scopeCond.SQL+`
			UNION
			SELECT year AS value FROM albums WHERE active = 1 AND year IS NOT NULL `+albumScope+`
		) ORDER BY value DESC`, args...)
	if err != nil {
		return nil, fmt.Errorf("list years: %w", err)
	}
	defer rows.Close()
	var years []int
	for rows.Next() {
		var y int
		if err := rows.Scan(&y); err != nil {
			return nil, fmt.Errorf("list years: %w", err)
		}
		years = append(years, y)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list years: %w", err)
	}
	return years, nil
}
