package search

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// Category is one searchable type; empty means all of them.
type Category string

const (
	CategorySongs     Category = "songs"
	CategoryAlbums    Category = "albums"
	CategoryArtists   Category = "artists"
	CategoryPlaylists Category = "playlists"
)

// Service runs catalog search. Every query enforces the caller's library
// scope (songs directly, albums/artists through an EXISTS probe, like the
// catalog module), restricts to active rows, and honors hideExplicit.
type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service { return &Service{db: db} }

// Search runs the categories the caller asked for. q is the raw query text;
// typ limits the search to one category ("" = all, already validated by the
// route); categoryLimit is the per-category row cap (already clamped).
func (s *Service) Search(ctx context.Context, id auth.Identity, q string, typ Category, categoryLimit int, hideExplicit bool) (*Results, error) {
	scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	results := &Results{
		Songs:     []Song{},
		Albums:    []Album{},
		Artists:   []Artist{},
		Playlists: []Playlist{},
	}
	if q = trimQuery(q); q == "" {
		return results, nil
	}
	want := func(c Category) bool { return typ == "" || typ == c }
	if want(CategorySongs) {
		songs, err := s.searchSongs(ctx, id.UserID, scope, q, categoryLimit, hideExplicit)
		if err != nil {
			return nil, err
		}
		results.Songs = songs
	}
	if want(CategoryAlbums) {
		albums, err := s.searchAlbums(ctx, id.UserID, scope, q, categoryLimit)
		if err != nil {
			return nil, err
		}
		results.Albums = albums
	}
	if want(CategoryArtists) {
		artists, err := s.searchArtists(ctx, id.UserID, scope, q, categoryLimit)
		if err != nil {
			return nil, err
		}
		results.Artists = artists
	}
	if want(CategoryPlaylists) {
		playlists, err := s.searchPlaylists(ctx, id.UserID, q, categoryLimit)
		if err != nil {
			return nil, err
		}
		results.Playlists = playlists
	}
	return results, nil
}

func trimQuery(q string) string {
	// Bound free text the same way v1's zod string did implicitly (it did
	// not bound at all; v2 caps the search box at maxQueryLen).
	if len(q) > maxQueryLen {
		q = q[:maxQueryLen]
	}
	return q
}

// searchSongs ranks by bm25 over the title index. If the FTS MATCH fails —
// a query string whose specials survive escaping — it degrades to a
// LIKE prefix query (documented in the package doc) instead of erroring.
func (s *Service) searchSongs(ctx context.Context, userID string, scope libraries.Scope, q string, limit int, hideExplicit bool) ([]Song, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	explicit := ""
	if hideExplicit {
		explicit = ` AND s.explicit = 0`
	}
	if fts, ok := ftsQuery(q); ok {
		rows, err := s.db.QueryContext(ctx,
			`SELECT s.id, s.title, s.track_number, s.disc_number, s.duration,
				s.artist_id, s.album_id, ar.name, al.name, s.genre, s.genre_id, s.year,
				s.explicit, s.cover_art_id, s.mtime, s.active, us.starred, us.rating
			FROM songs_fts
			JOIN songs s ON s.rowid = songs_fts.rowid
			LEFT JOIN artists ar ON ar.id = s.artist_id
			LEFT JOIN albums al ON al.id = s.album_id
			LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
			WHERE songs_fts MATCH ? AND s.active = 1 `+scopeCond.SQL+explicit+`
			ORDER BY bm25(songs_fts)
			LIMIT ?`,
			append(append([]any{userID, fts}, scopeCond.Params...), limit)...)
		if err == nil {
			songs, scanErr := scanSongs(rows)
			if scanErr != nil {
				return nil, scanErr
			}
			if err := attachSongRelations(ctx, s.db, songs); err != nil {
				return nil, err
			}
			return songs, nil
		}
		slog.WarnContext(ctx, "fts song search failed, falling back to LIKE", "query", q, "err", err)
	}
	pattern := likePrefixPattern(q)
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.id, s.title, s.track_number, s.disc_number, s.duration,
			s.artist_id, s.album_id, ar.name, al.name, s.genre, s.genre_id, s.year,
			s.explicit, s.cover_art_id, s.mtime, s.active, us.starred, us.rating
		FROM songs s
		LEFT JOIN artists ar ON ar.id = s.artist_id
		LEFT JOIN albums al ON al.id = s.album_id
		LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
		WHERE s.active = 1 AND s.title LIKE ? ESCAPE '\' `+scopeCond.SQL+explicit+`
		ORDER BY s.title
		LIMIT ?`,
		append(append([]any{userID, pattern}, scopeCond.Params...), limit)...)
	if err != nil {
		return nil, fmt.Errorf("fallback song search: %w", err)
	}
	songs, err := scanSongs(rows)
	if err != nil {
		return nil, err
	}
	if err := attachSongRelations(ctx, s.db, songs); err != nil {
		return nil, err
	}
	return songs, nil
}

// searchAlbums searches name + the denormalized artist text; bm25 weights
// the name column 5x the artist column so an album-name hit outranks an
// artist-name hit (the LIKE fallback orders by name, v1 parity).
func (s *Service) searchAlbums(ctx context.Context, userID string, scope libraries.Scope, q string, limit int) ([]Album, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	scopeFilter := ""
	scopeArgs := []any{}
	if !scope.All {
		scopeFilter = ` AND EXISTS (SELECT 1 FROM songs s WHERE s.album_id = a.id AND s.active = 1 ` + scopeCond.SQL + `)`
		scopeArgs = scopeCond.Params
	}
	columns := `a.id, a.name, a.artist_id, a.artist_name, a.year, a.genre, a.cover_art_id, a.active,
		ua.starred, ua.rating,
		(SELECT MAX(CASE WHEN s.explicit = 1 THEN 1 ELSE 0 END) FROM songs s WHERE s.album_id = a.id AND s.active = 1) AS explicit`
	joins := `FROM albums_fts
		JOIN albums a ON a.rowid = albums_fts.rowid
		LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id`
	if fts, ok := ftsQuery(q); ok {
		args := append([]any{userID, fts}, scopeArgs...)
		args = append(args, limit)
		rows, err := s.db.QueryContext(ctx,
			`SELECT `+columns+` `+joins+`
			WHERE albums_fts MATCH ? AND a.active = 1 `+scopeFilter+`
			ORDER BY bm25(albums_fts, 5.0, 1.0)
			LIMIT ?`, args...)
		if err == nil {
			albums, scanErr := scanAlbums(rows)
			if scanErr != nil {
				return nil, scanErr
			}
			if err := attachAlbumRelations(ctx, s.db, albums); err != nil {
				return nil, err
			}
			return albums, nil
		}
		slog.WarnContext(ctx, "fts album search failed, falling back to LIKE", "query", q, "err", err)
	}
	args := append([]any{userID, likePrefixPattern(q)}, scopeArgs...)
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+columns+`
		FROM albums a
		LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
		WHERE a.active = 1 AND a.name LIKE ? ESCAPE '\' `+scopeFilter+`
		ORDER BY a.name
		LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("fallback album search: %w", err)
	}
	albums, err := scanAlbums(rows)
	if err != nil {
		return nil, err
	}
	if err := attachAlbumRelations(ctx, s.db, albums); err != nil {
		return nil, err
	}
	return albums, nil
}

func (s *Service) searchArtists(ctx context.Context, userID string, scope libraries.Scope, q string, limit int) ([]Artist, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	scopeFilter := ""
	scopeArgs := []any{}
	if !scope.All {
		scopeFilter = ` AND EXISTS (SELECT 1 FROM songs s WHERE s.artist_id = ar.id AND s.active = 1 ` + scopeCond.SQL + `)`
		scopeArgs = scopeCond.Params
	}
	columns := `ar.id, ar.name, ar.active, ua.starred, ua.rating`
	if fts, ok := ftsQuery(q); ok {
		args := append([]any{userID, fts}, scopeArgs...)
		args = append(args, limit)
		rows, err := s.db.QueryContext(ctx,
			`SELECT `+columns+`
			FROM artists_fts
			JOIN artists ar ON ar.rowid = artists_fts.rowid
			LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
			WHERE artists_fts MATCH ? AND ar.active = 1 `+scopeFilter+`
			ORDER BY bm25(artists_fts)
			LIMIT ?`, args...)
		if err == nil {
			return scanArtists(rows)
		}
		slog.WarnContext(ctx, "fts artist search failed, falling back to LIKE", "query", q, "err", err)
	}
	args := append([]any{userID, likePrefixPattern(q)}, scopeArgs...)
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+columns+`
		FROM artists ar
		LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
		WHERE ar.active = 1 AND ar.name LIKE ? ESCAPE '\' `+scopeFilter+`
		ORDER BY ar.name
		LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("fallback artist search: %w", err)
	}
	return scanArtists(rows)
}

// searchPlaylists is name LIKE (escaped) under the playlist visibility
// rule — owner, public, or shared — the same policy the playlists module
// enforces per playlist, expressed as the list-form WHERE clause (v1
// parity; a per-row Resolve would be an N+1).
func (s *Service) searchPlaylists(ctx context.Context, userID, q string, limit int) ([]Playlist, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT p.id, p.name, p.owner_id, u.username, p.visibility, p.share_token, p.is_smart,
			p.created_at, p.updated_at,
			(SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count,
			up.starred, up.rating
		FROM playlists p
		JOIN users u ON u.id = p.owner_id
		LEFT JOIN user_playlists up ON up.user_id = ? AND up.playlist_id = p.id
		WHERE p.name LIKE ? ESCAPE '\'
			AND (p.owner_id = ? OR p.visibility = 'public'
				OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id AND ps.user_id = ?))
		ORDER BY p.updated_at DESC
		LIMIT ?`,
		userID, likePrefixPattern(q), userID, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("playlist search: %w", err)
	}
	defer rows.Close()
	playlists := []Playlist{}
	for rows.Next() {
		var p Playlist
		var shareToken sql.NullString
		var isSmart, starred sql.NullInt64
		var ratingF sql.NullFloat64
		if err := rows.Scan(&p.ID, &p.Name, &p.OwnerID, &p.OwnerUsername, &p.Visibility,
			&shareToken, &isSmart, &p.CreatedAt, &p.UpdatedAt, &p.SongCount, &starred, &ratingF); err != nil {
			return nil, fmt.Errorf("playlist search: %w", err)
		}
		if shareToken.Valid {
			p.ShareToken = &shareToken.String
		}
		p.IsSmart = isSmart.Valid && isSmart.Int64 == 1
		p.Starred = starred.Valid && starred.Int64 == 1
		if ratingF.Valid {
			p.Rating = &ratingF.Float64
		}
		p.SongIDs = []string{}
		playlists = append(playlists, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("playlist search: %w", err)
	}
	return playlists, nil
}
