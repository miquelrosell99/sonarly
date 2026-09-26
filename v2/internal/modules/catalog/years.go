package catalog

import (
	"context"
	"fmt"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
)

// listYears returns the distinct years of active in-scope songs with their
// song counts, newest first. (v1 unioned in album years and returned bare
// values; the v2 spec scopes years to songs and asks for counts.)
func listYears(ctx context.Context, q auth.Queries, scope libraries.Scope) ([]YearCount, error) {
	scopeCond := libraries.ScopeCondition(scope, "library_id")
	rows, err := q.QueryContext(ctx,
		`SELECT year, COUNT(*) AS song_count
		FROM songs
		WHERE active = 1 AND year IS NOT NULL `+scopeCond.SQL+`
		GROUP BY year
		ORDER BY year DESC`, scopeCond.Params...)
	if err != nil {
		return nil, fmt.Errorf("list years: %w", err)
	}
	defer rows.Close()
	var years []YearCount
	for rows.Next() {
		var y YearCount
		if err := rows.Scan(&y.Year, &y.SongCount); err != nil {
			return nil, fmt.Errorf("list years: %w", err)
		}
		years = append(years, y)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list years: %w", err)
	}
	return years, nil
}
