package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// albumColumns is the explicit column list album SELECTs share (no
// genre_id: the old album responses never exposed it). Interaction columns
// (starred, rating) and list aggregates are appended per query.
const albumColumns = `a.id, a.name, a.artist_id, a.artist_name, a.release_type, a.year,
	a.genre, a.cover_art_id, a.active, a.catalog_numbers, a.barcode, a.asin,
	a.musicbrainz_album_id, a.musicbrainz_release_group_id, a.musicbrainz_album_artist_ids,
	a.original_year, a.compilation, a.total_tracks, a.total_discs`

const (
	albumArtistJoin = "FROM album_artists j JOIN artists e ON e.id = j.artist_id WHERE j.album_id"
	albumGenreJoin  = "FROM album_genres j JOIN genres e ON e.id = j.genre_id WHERE j.album_id"
	albumLabelJoin  = "FROM album_labels j JOIN labels e ON e.id = j.label_id WHERE j.album_id"
)

// AlbumFilter is the /api/albums query surface.
type AlbumFilter struct {
	ArtistID     string
	GenreID      string
	Year         *int
	LibraryID    string
	HideExplicit bool
	Limit        int
}

// albumRow scans the shared album column order plus optional trailing
// interaction/aggregate columns.
type albumRow struct {
	id                string
	name              string
	artistID          *string
	artistName        *string
	releaseType       *string
	year              *int
	genre             *string
	coverArtID        *string
	active            int
	catalogNumbers    sql.NullString
	barcode           *string
	asin              *string
	mbzAlbumID        *string
	mbzReleaseGroupID *string
	mbzAlbumArtistIDs sql.NullString
	originalYear      *int
	compilation       sql.NullInt64
	totalTracks       *string
	totalDiscs        *string
	starred           sql.NullInt64
	rating            sql.NullFloat64
	totalCount        sql.NullInt64
	shownCount        sql.NullInt64
	anyExplicit       sql.NullInt64
}

// albumDests is the destination list for the shared albumColumns order.
// Callers append interaction/count destinations and make ONE Scan call —
// database/sql rows must be consumed in a single pass.
func albumDests(r *albumRow) []any {
	return []any{
		&r.id, &r.name, &r.artistID, &r.artistName, &r.releaseType, &r.year,
		&r.genre, &r.coverArtID, &r.active, &r.catalogNumbers, &r.barcode, &r.asin,
		&r.mbzAlbumID, &r.mbzReleaseGroupID, &r.mbzAlbumArtistIDs,
		&r.originalYear, &r.compilation, &r.totalTracks, &r.totalDiscs,
	}
}

func (r *albumRow) toAlbum() Album {
	a := Album{
		ID:             r.id,
		Name:           r.name,
		ArtistID:       r.artistID,
		ArtistName:     r.artistName,
		ReleaseType:    r.releaseType,
		Year:           r.year,
		Genre:          r.genre,
		CoverArt:       r.coverArtID,
		Active:         r.active == 1,
		Barcode:        r.barcode,
		ASIN:           r.asin,
		OriginalYear:   r.originalYear,
		Compilation:    r.compilation.Valid && r.compilation.Int64 == 1,
		TotalTracks:    r.totalTracks,
		TotalDiscs:     r.totalDiscs,
		Starred:        r.starred.Valid && r.starred.Int64 == 1,
		TotalSongCount: int(r.totalCount.Int64),
		ShownSongCount: int(r.shownCount.Int64),
		Explicit:       r.anyExplicit.Valid && r.anyExplicit.Int64 == 1,
	}
	if r.rating.Valid {
		a.Rating = &r.rating.Float64
	}
	if v, ok := parseStringArrayColumn(r.catalogNumbers); ok {
		a.CatalogNumbers = v
	}
	a.MusicBrainzAlbumID = r.mbzAlbumID
	a.MusicBrainzReleaseGroupID = r.mbzReleaseGroupID
	if v, ok := parseStringArrayColumn(r.mbzAlbumArtistIDs); ok {
		a.MusicBrainzAlbumArtistIDs = v
	}
	return a
}

func (r *albumRow) toArtistAlbum() ArtistAlbum {
	a := ArtistAlbum{
		ID:             r.id,
		Name:           r.name,
		Year:           r.year,
		Genre:          r.genre,
		CoverArt:       r.coverArtID,
		TotalSongCount: int(r.totalCount.Int64),
		ShownSongCount: int(r.shownCount.Int64),
		Starred:        r.starred.Valid && r.starred.Int64 == 1,
	}
	if r.rating.Valid {
		a.Rating = &r.rating.Float64
	}
	return a
}

// albumSongJoin builds the songs join album aggregations ride on. Scoped or
// library-filtered queries INNER JOIN in-scope active songs (counts and the
// library filter live on the join, wire parity); unrestricted queries LEFT
// JOIN so empty albums keep appearing with zero counts. joinArgs carries the
// join's bind values in placeholder order (library id, then scope ids).
func albumSongJoin(scope libraries.Scope, libraryID string) (joinSQL string, joinArgs []any) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	if libraryID == "" && scope.All {
		return `LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1`, nil
	}
	join := `JOIN songs s ON s.album_id = a.id AND s.active = 1`
	if libraryID != "" {
		join += ` AND s.library_id = ?`
		joinArgs = append(joinArgs, libraryID)
	}
	return join + ` ` + scopeCond.SQL, append(joinArgs, scopeCond.Params...)
}

// shownSongCountExpr counts songs the caller would actually see: real songs
// only (a LEFT JOIN gap does not count as a visible song — the old SUM(CASE)
// reported 1 for empty albums, which the Go server fixes), minus explicit songs when
// the hide flag binds to 1.
const shownSongCountExpr = `SUM(CASE
		WHEN s.id IS NOT NULL AND ? = 1 AND s.explicit = 1 THEN 0
		WHEN s.id IS NOT NULL THEN 1
		ELSE 0 END)`

// listAlbums is the /api/albums query (the old list with the artist/year
// filters folded in).
func listAlbums(ctx context.Context, q auth.Queries, userID string, scope libraries.Scope, f AlbumFilter) ([]Album, error) {
	joinSQL, joinArgs := albumSongJoin(scope, f.LibraryID)
	hide := 0
	if f.HideExplicit {
		hide = 1
	}
	where := `WHERE a.active = 1`
	args := []any{hide}
	args = append(args, joinArgs...)
	args = append(args, userID)
	if f.ArtistID != "" {
		where += ` AND a.artist_id = ?`
		args = append(args, f.ArtistID)
	}
	if f.Year != nil {
		where += ` AND a.year = ?`
		args = append(args, *f.Year)
	}
	if f.GenreID != "" {
		where += ` AND EXISTS (SELECT 1 FROM album_genres ag WHERE ag.album_id = a.id AND ag.genre_id = ?)`
		args = append(args, f.GenreID)
	}
	groupBy := `GROUP BY a.id`
	if f.HideExplicit {
		// Drop albums whose songs are all explicit, but keep songless
		// albums: hiding explicit content must not hide empty ones (the old
		// SUM(CASE) quirk kept them via a phantom count; the Go server states the rule).
		groupBy += ` HAVING total_song_count = 0 OR shown_song_count > 0`
	}
	args = append(args, f.Limit)

	rows, err := q.QueryContext(ctx,
		`SELECT `+albumColumns+`, ua.starred, ua.rating,
			COUNT(s.id) AS total_song_count,
			`+shownSongCountExpr+` AS shown_song_count,
			MAX(s.explicit) AS any_explicit
		FROM albums a
		`+joinSQL+`
		LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
		`+where+` `+groupBy+` ORDER BY a.name LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("list albums: %w", err)
	}
	defer rows.Close()
	var albums []Album
	for rows.Next() {
		r := &albumRow{}
		dests := append(albumDests(r), &r.starred, &r.rating, &r.totalCount, &r.shownCount, &r.anyExplicit)
		if err := rows.Scan(dests...); err != nil {
			return nil, fmt.Errorf("list albums: %w", err)
		}
		albums = append(albums, r.toAlbum())
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list albums: %w", err)
	}
	if err := attachAlbumRelations(ctx, q, albums); err != nil {
		return nil, err
	}
	return albums, nil
}

// getAlbumByID loads one active album with its per-user state. Scope is
// probed by the service (IsAlbumInScope), not folded into this query.
func getAlbumByID(ctx context.Context, q auth.Queries, userID, id string) (*Album, error) {
	r := &albumRow{}
	dests := append(albumDests(r), &r.starred, &r.rating)
	err := q.QueryRowContext(ctx,
		`SELECT `+albumColumns+`, ua.starred, ua.rating
		FROM albums a
		LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
		WHERE a.id = ? AND a.active = 1`, userID, id).Scan(dests...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, fmt.Errorf("get album: %w", err)
	}
	album := r.toAlbum()
	return &album, nil
}

// listAlbumsByArtist loads the album cards embedded in the artist detail
// response (the old /api/artists/:id albums query: year, name order, no limit).
func listAlbumsByArtist(ctx context.Context, q auth.Queries, userID, artistID, libraryID string, scope libraries.Scope, hideExplicit bool) ([]ArtistAlbum, error) {
	joinSQL, joinArgs := albumSongJoin(scope, libraryID)
	hide := 0
	if hideExplicit {
		hide = 1
	}
	groupBy := `GROUP BY a.id`
	if hideExplicit {
		groupBy += ` HAVING total_song_count = 0 OR shown_song_count > 0`
	}
	args := []any{hide}
	args = append(args, joinArgs...)
	args = append(args, userID, artistID)

	rows, err := q.QueryContext(ctx,
		`SELECT a.id, a.name, a.year, a.genre, a.cover_art_id, ua.starred, ua.rating,
			COUNT(s.id) AS total_song_count,
			`+shownSongCountExpr+` AS shown_song_count
		FROM albums a
		`+joinSQL+`
		LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
		WHERE a.artist_id = ? AND a.active = 1
		`+groupBy+` ORDER BY a.year, a.name`, args...)
	if err != nil {
		return nil, fmt.Errorf("list albums by artist: %w", err)
	}
	defer rows.Close()
	var albums []ArtistAlbum
	for rows.Next() {
		var r albumRow
		if err := rows.Scan(&r.id, &r.name, &r.year, &r.genre, &r.coverArtID,
			&r.starred, &r.rating, &r.totalCount, &r.shownCount); err != nil {
			return nil, fmt.Errorf("list albums by artist: %w", err)
		}
		albums = append(albums, r.toArtistAlbum())
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list albums by artist: %w", err)
	}
	return albums, nil
}

// attachAlbumRelations batch-attaches artist names, genre names, and label
// entries to a list of albums (the old list handler), one chunked IN query per
// relation.
func attachAlbumRelations(ctx context.Context, q auth.Queries, albums []Album) error {
	if len(albums) == 0 {
		return nil
	}
	ids := albumIDs(albums)
	artists, err := namesForMany(ctx, q, "album_id", albumArtistJoin, ids)
	if err != nil {
		return err
	}
	genres, err := namesForMany(ctx, q, "album_id", albumGenreJoin, ids)
	if err != nil {
		return err
	}
	labels, err := entriesForMany(ctx, q, "album_id", albumLabelJoin, ids)
	if err != nil {
		return err
	}
	for i := range albums {
		if names, ok := artists[albums[i].ID]; ok {
			albums[i].Artists = names
		}
		if names, ok := genres[albums[i].ID]; ok {
			albums[i].Genres = names
		}
		if entries, ok := labels[albums[i].ID]; ok {
			albums[i].LabelEntries = entries
		}
	}
	return nil
}

// albumRelations loads one album's artist names, genre names, and label
// entries in a single UNION ALL query (the old detail handler ran
// getAlbumArtistNames + getAlbumGenreNames + getAlbumLabelEntries
// separately; folding them keeps the detail endpoint's statement count
// flat). Rows come out grouped by kind and ordered by junction position.
func albumRelations(ctx context.Context, q auth.Queries, albumID string) (artists []string, genres []string, labels []Entry, err error) {
	rows, err := q.QueryContext(ctx,
		`SELECT 'artist' AS kind, j.position, e.id, e.name
		FROM album_artists j JOIN artists e ON e.id = j.artist_id WHERE j.album_id = ?
		UNION ALL
		SELECT 'genre', j.position, e.id, e.name
		FROM album_genres j JOIN genres e ON e.id = j.genre_id WHERE j.album_id = ?
		UNION ALL
		SELECT 'label', j.position, e.id, e.name
		FROM album_labels j JOIN labels e ON e.id = j.label_id WHERE j.album_id = ?
		ORDER BY kind, position`, albumID, albumID, albumID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("album relations: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var kind, id, name string
		var position int
		if err := rows.Scan(&kind, &position, &id, &name); err != nil {
			return nil, nil, nil, fmt.Errorf("album relations: %w", err)
		}
		switch kind {
		case "artist":
			artists = append(artists, name)
		case "genre":
			genres = append(genres, name)
		case "label":
			labels = append(labels, Entry{ID: id, Name: name})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, nil, fmt.Errorf("album relations: %w", err)
	}
	return artists, genres, labels, nil
}
