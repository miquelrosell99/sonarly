// Package interactions is the native favorites/ratings surface (P9c
// native-parity gap from the frontend audit). The OpenSubsonic adapter's
// star/unstar/setRating and these endpoints write the SAME user_songs /
// user_albums / user_artists junction rows — one data path — and the song
// average_rating recompute is shared semantics with v1's setRating.
package interactions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// ErrInvalidInput marks a request-body validation failure (400); the route
// layer surfaces the message.
var ErrInvalidInput = errors.New("interactions: invalid input")

func invalidf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, fmt.Sprintf(format, args...))
}

// entityJunction maps the body key to the junction table v1's favorites
// repository used. Playlists join the set for v1 wire parity: the web
// client sends entityType 'playlist' for playlist favorites/ratings.
type entityJunction struct {
	table    string
	idColumn string
}

var (
	songJunction     = entityJunction{"user_songs", "song_id"}
	albumJunction    = entityJunction{"user_albums", "album_id"}
	artistJunction   = entityJunction{"user_artists", "artist_id"}
	playlistJunction = entityJunction{"user_playlists", "playlist_id"}
)

// entityFor validates the discriminated id body ({songId|albumId|artistId|
// playlistId}, exactly one) and returns its junction target. v1's native
// endpoints took {entityType, entityId} (routed here by the handlers); the
// v2 native body may also use the id keys directly.
func entityFor(songID, albumID, artistID, playlistID string) (entityJunction, string, error) {
	ids := map[string]string{"song": songID, "album": albumID, "artist": artistID, "playlist": playlistID}
	set := []string{}
	for kind, id := range ids {
		if id != "" {
			set = append(set, kind)
		}
	}
	if len(set) != 1 {
		return entityJunction{}, "", invalidf("exactly one entity id is required")
	}
	switch set[0] {
	case "song":
		return songJunction, songID, nil
	case "album":
		return albumJunction, albumID, nil
	case "artist":
		return artistJunction, artistID, nil
	default:
		return playlistJunction, playlistID, nil
	}
}

// Service owns the junction writes.
type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service { return &Service{db: db} }

// SetFavorite stars or unstars the entity for the caller (v1 setFavorite:
// upsert of the starred flag; absent entities are not probed — the junction
// row is harmless and v1 did the same).
func (s *Service) SetFavorite(ctx context.Context, id auth.Identity, songID, albumID, artistID, playlistID string, starred bool) error {
	junction, entityID, err := entityFor(songID, albumID, artistID, playlistID)
	if err != nil {
		return err
	}
	star := 0
	if starred {
		star = 1
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO `+junction.table+` (user_id, `+junction.idColumn+`, starred) VALUES (?, ?, ?)
		ON CONFLICT(user_id, `+junction.idColumn+`) DO UPDATE SET starred = excluded.starred`,
		id.UserID, entityID, star)
	if err != nil {
		return fmt.Errorf("set favorite: %w", err)
	}
	return nil
}

// SetRating stores the caller's rating (0..5 in 0.5 steps, v1 half-ratings)
// or clears it with nil. Song ratings recompute songs.average_rating exactly
// like v1's setRating (albums/artists compute the average at read time).
func (s *Service) SetRating(ctx context.Context, id auth.Identity, songID, albumID, artistID, playlistID string, rating *float64) error {
	junction, entityID, err := entityFor(songID, albumID, artistID, playlistID)
	if err != nil {
		return err
	}
	if rating != nil {
		r := *rating
		if math.IsNaN(r) || math.IsInf(r, 0) || r < 0 || r > 5 || r*2 != math.Round(r*2) {
			return invalidf("rating must be between 0 and 5 in 0.5 increments")
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin set rating: %w", err)
	}
	defer tx.Rollback()
	var value any
	if rating != nil {
		value = *rating
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO `+junction.table+` (user_id, `+junction.idColumn+`, rating) VALUES (?, ?, ?)
		ON CONFLICT(user_id, `+junction.idColumn+`) DO UPDATE SET rating = excluded.rating`,
		id.UserID, entityID, value); err != nil {
		return fmt.Errorf("set rating: %w", err)
	}
	if junction.table == "user_songs" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE songs
			SET average_rating = (SELECT AVG(rating) FROM user_songs WHERE song_id = ?)
			WHERE id = ?`, entityID, entityID); err != nil {
			return fmt.Errorf("recompute average rating: %w", err)
		}
	}
	return tx.Commit()
}
