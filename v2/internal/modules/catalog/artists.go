package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
)

// artistColumns is the v1 artist API surface: image fields pass through to
// the DTO, with the local path becoming an artistImageUrl route reference.
const artistColumns = `ar.id, ar.name, ar.active, ar.artist_image_local_path,
	ar.musicbrainz_artist_ids, ar.bio, ar.external_urls`

// artistScopeExists matches v1's artist reachability rule: at least one
// active song whose library is in scope (optionally within one library).
// The placeholder order is [library_id?, ...scope ids].
const artistScopeExists = `EXISTS (
	SELECT 1 FROM songs s
	WHERE s.artist_id = ar.id AND s.active = 1 %s %s)`

type artistRow struct {
	id             string
	name           string
	active         int
	imageLocalPath sql.NullString
	mbzArtistIDs   sql.NullString
	bio            sql.NullString
	externalURLs   sql.NullString
	starred        sql.NullInt64
	rating         sql.NullFloat64
}

func artistDests(r *artistRow) []any {
	return []any{
		&r.id, &r.name, &r.active, &r.imageLocalPath,
		&r.mbzArtistIDs, &r.bio, &r.externalURLs,
	}
}

func (r *artistRow) toArtist() Artist {
	a := Artist{
		ID:      r.id,
		Name:    r.name,
		Active:  r.active == 1,
		Starred: r.starred.Valid && r.starred.Int64 == 1,
	}
	if r.rating.Valid {
		a.Rating = &r.rating.Float64
	}
	if v, ok := parseStringArrayColumn(r.mbzArtistIDs); ok {
		a.MusicBrainzArtistIDs = v
	}
	if r.bio.Valid {
		a.Bio = &r.bio.String
	}
	if v, ok := parseAnyColumn(r.externalURLs); ok {
		a.ExternalURLs = v
	}
	if r.imageLocalPath.Valid && r.imageLocalPath.String != "" {
		a.ArtistImageURL = "/api/artist-images/" + r.id
	}
	return a
}

// listArtists returns active artists reachable under the scope (v1 parity:
// an artist appears when at least one of its songs is an in-scope active
// song; admins with no library filter see every active artist).
func listArtists(ctx context.Context, q auth.Queries, userID, libraryID string, scope libraries.Scope) ([]Artist, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	where := `WHERE ar.active = 1`
	args := []any{userID}
	if libraryID != "" || !scope.All {
		libClause, libArg := ``, []any(nil)
		if libraryID != "" {
			libClause, libArg = `AND s.library_id = ?`, []any{libraryID}
		}
		where += fmt.Sprintf(` AND `+artistScopeExists, libClause, scopeCond.SQL)
		args = append(args, libArg...)
		args = append(args, scopeCond.Params...)
	}

	rows, err := q.QueryContext(ctx,
		`SELECT `+artistColumns+`, ua.starred, ua.rating
		FROM artists ar
		LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
		`+where+` ORDER BY ar.name`, args...)
	if err != nil {
		return nil, fmt.Errorf("list artists: %w", err)
	}
	defer rows.Close()
	var artists []Artist
	for rows.Next() {
		r := &artistRow{}
		dests := append(artistDests(r), &r.starred, &r.rating)
		if err := rows.Scan(dests...); err != nil {
			return nil, fmt.Errorf("list artists: %w", err)
		}
		artists = append(artists, r.toArtist())
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list artists: %w", err)
	}
	return artists, nil
}

// getArtistByID loads one active artist with its per-user state. Reachability
// is probed by the service (IsArtistInScope), not folded into this query.
func getArtistByID(ctx context.Context, q auth.Queries, userID, id string) (*Artist, error) {
	r := &artistRow{}
	dests := append(artistDests(r), &r.starred, &r.rating)
	err := q.QueryRowContext(ctx,
		`SELECT `+artistColumns+`, ua.starred, ua.rating
		FROM artists ar
		LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
		WHERE ar.id = ? AND ar.active = 1`, userID, id).Scan(dests...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, fmt.Errorf("get artist: %w", err)
	}
	a := r.toArtist()
	return &a, nil
}
