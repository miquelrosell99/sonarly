package playlists

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// This file is the OpenSubsonic adapter's read projection (P9b). The adapter
// (/rest/getPlaylists.view) must NOT grow its own playlist queries: the
// visibility set, the smart/static count semantics, and the duration math
// all live here, on top of the same ListVisible + Compile + Resolve policy
// the native routes use. wire parity notes:
//
//   - getPlaylists sorts by playlist NAME (old opensubsonic-routes.ts), not
//     by updated_at like the native list view.
//   - the list view carries no entries; songCount follows the old
//     resolvePlaylistSongCount (smart → limit-aware compiled count, static →
//     raw member count) and duration follows the old
//     resolvePlaylistSongDuration (SUM over the resolved ids, no liveness
//     filter — the old sumSongDurations did not check active).

// SubsonicListItem is one getPlaylists entry: display fields plus the
// resolved count/duration, no entries. CreatedAt/UpdatedAt are the raw
// database strings (SQLite datetime); the adapter renders ISO.
type SubsonicListItem struct {
	ID            string
	Name          string
	OwnerUsername string
	Visibility    string
	SongCount     int
	Duration      int
	CreatedAt     string
	UpdatedAt     string
}

// SubsonicList answers /rest/getPlaylists.view: every playlist the caller
// may see (owner + public + shared, via the one ListVisible query), ordered
// by name, each with its resolved count and duration.
func (s *Service) SubsonicList(ctx context.Context, id auth.Identity) ([]SubsonicListItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.id, p.name, p.owner_id, u.username, p.visibility,
		       p.is_smart, p.rules_json, p.resolve_mode, p.created_at, p.updated_at,
		       (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count
		FROM playlists p
		JOIN users u ON u.id = p.owner_id
		WHERE p.owner_id = ?
		   OR p.visibility = 'public'
		   OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id AND ps.user_id = ?)
		ORDER BY p.name`, id.UserID, id.UserID)
	if err != nil {
		return nil, fmt.Errorf("subsonic list playlists: %w", err)
	}
	defer rows.Close()

	type row struct {
		p         Playlist
		songCount int
	}
	list := []row{}
	for rows.Next() {
		var r row
		var description, shareToken, rulesJSON sql.NullString
		var isSmart int
		if err := rows.Scan(&r.p.ID, &r.p.Name, &r.p.OwnerID, &r.p.OwnerUsername,
			&r.p.Visibility, &isSmart, &rulesJSON, &r.p.ResolveMode, &r.p.CreatedAt,
			&r.p.UpdatedAt, &r.songCount); err != nil {
			return nil, fmt.Errorf("subsonic list playlists: %w", err)
		}
		if description.Valid {
			r.p.Description = description.String
		}
		if shareToken.Valid {
			r.p.ShareToken = shareToken.String
		}
		r.p.IsSmart = isSmart == 1
		r.p.ResolveMode = NormalizeResolveMode(r.p.ResolveMode)
		if rulesJSON.Valid && rulesJSON.String != "" {
			if rules, err := ParseRules([]byte(rulesJSON.String)); err == nil {
				r.p.Rules = rules
			}
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("subsonic list playlists: %w", err)
	}

	out := make([]SubsonicListItem, 0, len(list))
	for _, r := range list {
		item := SubsonicListItem{
			ID:            r.p.ID,
			Name:          r.p.Name,
			OwnerUsername: r.p.OwnerUsername,
			Visibility:    r.p.Visibility,
			SongCount:     r.songCount,
			CreatedAt:     r.p.CreatedAt,
			UpdatedAt:     r.p.UpdatedAt,
		}
		if r.p.IsSmart {
			count, err := s.resolveCount(ctx, &r.p, id.UserID)
			if err != nil {
				return nil, err
			}
			item.SongCount = count
		}
		ids, err := s.resolveSongIDs(ctx, &r.p, id.UserID)
		if err != nil {
			return nil, err
		}
		item.Duration, err = sumDurations(ctx, s.db, ids)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}

// sumDurations is the old sumSongDurations: the summed duration of exactly the
// given ids, chunked under SQLite's variable limit, with NO liveness or
// scope filter (the list view describes the playlist, like the retired server).
func sumDurations(ctx context.Context, q auth.Queries, ids []string) (int, error) {
	total := 0
	const chunk = 500
	for i := 0; i < len(ids); i += chunk {
		part := ids[i:min(i+chunk, len(ids))]
		ph := ""
		args := make([]any, len(part))
		for j, id := range part {
			if j > 0 {
				ph += ", "
			}
			ph += "?"
			args[j] = id
		}
		var sum sql.NullFloat64
		err := q.QueryRowContext(ctx,
			`SELECT SUM(duration) FROM songs WHERE id IN (`+ph+`)`, args...).Scan(&sum)
		if err != nil {
			return 0, fmt.Errorf("sum song durations: %w", err)
		}
		if sum.Valid {
			total += int(sum.Float64)
		}
	}
	return total, nil
}
