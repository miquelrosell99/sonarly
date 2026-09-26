package playback

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// maxBookmarkCommentLen bounds the free-form bookmark comment (the old 
// createBookmark accepted an unbounded OpenSubsonic query parameter).
const maxBookmarkCommentLen = 1000

// BookmarkSong is the song information joined into a bookmark entry (the
// slice the retired server web client's bookmark UI displays).
type BookmarkSong struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Duration   int    `json:"duration"` // seconds; 0 when unknown
	ArtistName string `json:"artistName,omitempty"`
	AlbumName  string `json:"albumName,omitempty"`
}

// Bookmark is one row of GET /api/bookmarks. Shape follows the old bookmark
// repository; the song embeds the joined display names.
type Bookmark struct {
	SongID    string       `json:"songId"`
	Position  int          `json:"position"`
	Comment   *string      `json:"comment"`
	CreatedAt string       `json:"createdAt"`
	UpdatedAt string       `json:"updatedAt"`
	Song      BookmarkSong `json:"song"`
}

// ListBookmarks returns the caller's own bookmarks, newest change first,
// joined with song display info and restricted to songs that are still
// active and inside the caller's library scope (the old getBookmarks semantics:
// out-of-scope or vanished songs simply drop out of the list).
func (s *Service) ListBookmarks(ctx context.Context, id auth.Identity) ([]Bookmark, error) {
	scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	rows, err := s.db.QueryContext(ctx, `
		SELECT b.song_id, b.position, b.comment, b.created_at, b.updated_at,
			s.id, s.title, s.duration, ar.name, al.name
		FROM bookmarks b
		JOIN songs s ON s.id = b.song_id AND s.active = 1
		LEFT JOIN artists ar ON ar.id = s.artist_id
		LEFT JOIN albums al ON al.id = s.album_id
		WHERE b.user_id = ? `+scopeCond.SQL+`
		ORDER BY b.updated_at DESC`,
		append([]any{id.UserID}, scopeCond.Params...)...)
	if err != nil {
		return nil, fmt.Errorf("list bookmarks: %w", err)
	}
	defer rows.Close()

	bookmarks := []Bookmark{}
	for rows.Next() {
		var b Bookmark
		var comment sql.NullString
		// s.duration is a fractional REAL on written by the retired server legacy rows; the
		// tolerant db.NullInt64 truncates instead of failing the list.
		var duration db.NullInt64
		var artistName, albumName sql.NullString
		if err := rows.Scan(&b.SongID, &b.Position, &comment, &b.CreatedAt, &b.UpdatedAt,
			&b.Song.ID, &b.Song.Title, &duration, &artistName, &albumName); err != nil {
			return nil, fmt.Errorf("list bookmarks: %w", err)
		}
		if comment.Valid {
			b.Comment = &comment.String
		}
		if v, ok := duration.Value(); ok {
			b.Song.Duration = int(v)
		}
		b.Song.ArtistName = artistName.String
		b.Song.AlbumName = albumName.String
		bookmarks = append(bookmarks, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list bookmarks: %w", err)
	}
	return bookmarks, nil
}

// SubsonicBookmark is one raw bookmark row for the OpenSubsonic adapter
// (P9b): no song join, no scope filter. The adapter renders the full
// Subsonic song child itself and keeps bookmarks whose song dropped out of
// the catalog in the list with the entry omitted — the old getBookmarks.view
// behavior, which differs from the native list view above.
type SubsonicBookmark struct {
	SongID    string
	Position  int
	Comment   *string
	CreatedAt string
	UpdatedAt string
}

// SubsonicBookmarks returns the caller's bookmark rows newest-change-first,
// exactly as stored (the old bookmarks getBookmarks repository function).
func (s *Service) SubsonicBookmarks(ctx context.Context, id auth.Identity) ([]SubsonicBookmark, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT song_id, position, comment, created_at, updated_at
		FROM bookmarks
		WHERE user_id = ?
		ORDER BY updated_at DESC`, id.UserID)
	if err != nil {
		return nil, fmt.Errorf("subsonic list bookmarks: %w", err)
	}
	defer rows.Close()
	out := []SubsonicBookmark{}
	for rows.Next() {
		var b SubsonicBookmark
		var comment sql.NullString
		if err := rows.Scan(&b.SongID, &b.Position, &comment, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, fmt.Errorf("subsonic list bookmarks: %w", err)
		}
		if comment.Valid {
			b.Comment = &comment.String
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("subsonic list bookmarks: %w", err)
	}
	return out, nil
}

// PutBookmark upserts the caller's bookmark for the song (old createBookmark:
// PK (user_id, song_id), position and comment replaced, updated_at bumped).
// The song must be active and in scope, else ErrNotFound.
func (s *Service) PutBookmark(ctx context.Context, id auth.Identity, songID string, position int, comment *string) error {
	if _, err := s.loadPlayableSong(ctx, id, songID, ""); err != nil {
		return err
	}
	var commentValue any
	if comment != nil {
		commentValue = *comment
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO bookmarks (user_id, song_id, position, comment)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, song_id) DO UPDATE SET
			position = excluded.position,
			comment = excluded.comment,
			updated_at = datetime('now')`,
		id.UserID, songID, position, commentValue)
	return err
}

// DeleteBookmark removes the caller's bookmark for the song. Like the old 
// deleteBookmark route, deleting a bookmark that does not exist is a no-op,
// not an error; only an unplayable (missing/inactive/out-of-scope) song id
// answers ErrNotFound.
func (s *Service) DeleteBookmark(ctx context.Context, id auth.Identity, songID string) error {
	if _, err := s.loadPlayableSong(ctx, id, songID, ""); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM bookmarks WHERE user_id = ? AND song_id = ?`, id.UserID, songID)
	return err
}
