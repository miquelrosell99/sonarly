package playlists

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// ErrNotFound is the single not-found sentinel: routes answer 404 both when
// a playlist is missing and when the caller has no access, so inaccessible
// ids cannot be probed (v2 contract: 404, not 403).
var ErrNotFound = errors.New("playlists: not found")

// ErrForbidden marks an authenticated caller who can view but not edit, or
// who attempts an owner-only operation on someone else's playlist (403).
var ErrForbidden = errors.New("playlists: forbidden")

// listRow is one row of the list query with its display join.
type listRow struct {
	playlist  Playlist
	songCount int
	starred   bool
	rating    *float64
}

// GetByID loads one playlist by id, parsing its rules. Rules that fail to
// parse degrade to nil (treated as unconstrained) — stored rules were
// validated at write time, so a parse failure means hand-edited data.
func GetByID(ctx context.Context, q auth.Queries, id string) (*Playlist, error) {
	var p Playlist
	var description, shareToken, rulesJSON sql.NullString
	var isSmart int
	err := q.QueryRowContext(ctx, `
		SELECT p.id, p.name, p.description, p.owner_id, u.username, p.visibility,
		       p.share_token, p.is_smart, p.rules_json, p.resolve_mode, p.created_at, p.updated_at
		FROM playlists p JOIN users u ON u.id = p.owner_id
		WHERE p.id = ?`, id).
		Scan(&p.ID, &p.Name, &description, &p.OwnerID, &p.OwnerUsername,
			&p.Visibility, &shareToken, &isSmart, &rulesJSON, &p.ResolveMode,
			&p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load playlist: %w", err)
	}
	if description.Valid {
		p.Description = description.String
	}
	if shareToken.Valid {
		p.ShareToken = shareToken.String
	}
	p.IsSmart = isSmart == 1
	p.ResolveMode = NormalizeResolveMode(p.ResolveMode)
	if rulesJSON.Valid && rulesJSON.String != "" {
		if rules, err := ParseRules([]byte(rulesJSON.String)); err == nil {
			p.Rules = rules
		}
	}
	return &p, nil
}

// ListVisible loads the playlists a user may see in the list view: owned,
// public, and shared-with-me (v1 parity, ORDER BY updated_at DESC).
func ListVisible(ctx context.Context, q auth.Queries, userID string) ([]listRow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT p.id, p.name, p.description, p.owner_id, u.username, p.visibility,
		       p.share_token, p.is_smart, p.rules_json, p.resolve_mode, p.created_at, p.updated_at,
		       (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count,
		       up.starred, up.rating
		FROM playlists p
		JOIN users u ON u.id = p.owner_id
		LEFT JOIN user_playlists up ON up.user_id = ? AND up.playlist_id = p.id
		WHERE p.owner_id = ?
		   OR p.visibility = 'public'
		   OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id AND ps.user_id = ?)
		ORDER BY p.updated_at DESC`, userID, userID, userID)
	if err != nil {
		return nil, fmt.Errorf("list playlists: %w", err)
	}
	defer rows.Close()
	out := []listRow{}
	for rows.Next() {
		var p Playlist
		var description, shareToken, rulesJSON sql.NullString
		var isSmart int
		var starred sql.NullInt64
		var ratingF sql.NullFloat64
		var r listRow
		if err := rows.Scan(&p.ID, &p.Name, &description, &p.OwnerID, &p.OwnerUsername,
			&p.Visibility, &shareToken, &isSmart, &rulesJSON, &p.ResolveMode,
			&p.CreatedAt, &p.UpdatedAt, &r.songCount, &starred, &ratingF); err != nil {
			return nil, fmt.Errorf("list playlists: %w", err)
		}
		if description.Valid {
			p.Description = description.String
		}
		if shareToken.Valid {
			p.ShareToken = shareToken.String
		}
		p.IsSmart = isSmart == 1
		p.ResolveMode = NormalizeResolveMode(p.ResolveMode)
		if rulesJSON.Valid && rulesJSON.String != "" {
			if rules, err := ParseRules([]byte(rulesJSON.String)); err == nil {
				p.Rules = rules
			}
		}
		r.playlist = p
		r.starred = starred.Valid && starred.Int64 == 1
		if ratingF.Valid {
			f := ratingF.Float64
			r.rating = &f
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list playlists: %w", err)
	}
	return out, nil
}

// SongIDs returns the position-ordered member ids of a static playlist.
func SongIDs(ctx context.Context, q auth.Queries, playlistID string) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT song_id FROM playlist_songs WHERE playlist_id = ? ORDER BY position`, playlistID)
	if err != nil {
		return nil, fmt.Errorf("list playlist songs: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("list playlist songs: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list playlist songs: %w", err)
	}
	return ids, nil
}

// Create inserts a playlist and, for static playlists, its members — in ONE
// transaction (v1 B3 fix: the row insert and member rewrites must not be
// observable separately).
func Create(ctx context.Context, db *sql.DB, p *Playlist, songIDs []string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := insertPlaylist(ctx, tx, p); err != nil {
		return err
	}
	if !p.IsSmart {
		if err := insertMembers(ctx, tx, p.ID, songIDs); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Update rewrites the playlist row and, when rewriteMembers is set, replaces
// the member list with exactly songIDs — in ONE transaction. Smart playlists
// always carry an empty member list; rewriteMembers clears any stale rows
// (v1 parity for smart/static conversions).
func Update(ctx context.Context, db *sql.DB, p *Playlist, songIDs []string, rewriteMembers bool) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rulesJSON := sql.NullString{}
	if p.IsSmart && p.Rules != nil {
		raw, err := json.Marshal(p.Rules)
		if err != nil {
			return fmt.Errorf("encode rules: %w", err)
		}
		rulesJSON = sql.NullString{String: string(raw), Valid: true}
	}
	isSmart := 0
	if p.IsSmart {
		isSmart = 1
	}
	shareToken := sql.NullString{}
	if p.ShareToken != "" {
		shareToken = sql.NullString{String: p.ShareToken, Valid: true}
	}
	description := sql.NullString{}
	if p.Description != "" {
		description = sql.NullString{String: p.Description, Valid: true}
	}
	res, err := tx.ExecContext(ctx, `
		UPDATE playlists
		SET name = ?, description = ?, visibility = ?, share_token = ?, is_smart = ?,
		    rules_json = ?, resolve_mode = ?, updated_at = datetime('now')
		WHERE id = ?`,
		p.Name, description, p.Visibility, shareToken, isSmart, rulesJSON,
		NormalizeResolveMode(p.ResolveMode), p.ID)
	if err != nil {
		return fmt.Errorf("update playlist: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if rewriteMembers {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM playlist_songs WHERE playlist_id = ?`, p.ID); err != nil {
			return fmt.Errorf("clear playlist members: %w", err)
		}
		if !p.IsSmart {
			if err := insertMembers(ctx, tx, p.ID, songIDs); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func insertPlaylist(ctx context.Context, tx *sql.Tx, p *Playlist) error {
	rulesJSON := sql.NullString{}
	if p.IsSmart && p.Rules != nil {
		raw, err := json.Marshal(p.Rules)
		if err != nil {
			return fmt.Errorf("encode rules: %w", err)
		}
		rulesJSON = sql.NullString{String: string(raw), Valid: true}
	}
	isSmart := 0
	if p.IsSmart {
		isSmart = 1
	}
	shareToken := sql.NullString{}
	if p.ShareToken != "" {
		shareToken = sql.NullString{String: p.ShareToken, Valid: true}
	}
	description := sql.NullString{}
	if p.Description != "" {
		description = sql.NullString{String: p.Description, Valid: true}
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO playlists (id, name, description, owner_id, visibility, share_token, is_smart, rules_json, resolve_mode)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, description, p.OwnerID, p.Visibility, shareToken, isSmart,
		rulesJSON, NormalizeResolveMode(p.ResolveMode))
	if err != nil {
		return fmt.Errorf("insert playlist: %w", err)
	}
	return nil
}

// insertMembers writes the position-ordered member list. Duplicate ids are
// collapsed (a playlist is a set with positions; PRIMARY KEY would reject
// duplicates mid-transaction anyway).
func insertMembers(ctx context.Context, tx *sql.Tx, playlistID string, songIDs []string) error {
	seen := make(map[string]bool, len(songIDs))
	position := 0
	for _, id := range songIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)`,
			playlistID, id, position); err != nil {
			return fmt.Errorf("insert playlist member: %w", err)
		}
		position++
	}
	return nil
}

// Delete removes a playlist row (members and shares cascade via FK).
func Delete(ctx context.Context, q auth.Queries, playlistID string) error {
	res, err := q.ExecContext(ctx, `DELETE FROM playlists WHERE id = ?`, playlistID)
	if err != nil {
		return fmt.Errorf("delete playlist: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ShareUpsert grants (or updates) a user share.
func ShareUpsert(ctx context.Context, q auth.Queries, playlistID, userID string, canEdit bool) error {
	edit := 0
	if canEdit {
		edit = 1
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO playlist_shares (playlist_id, user_id, can_edit) VALUES (?, ?, ?)
		ON CONFLICT(playlist_id, user_id) DO UPDATE SET can_edit = excluded.can_edit`,
		playlistID, userID, edit)
	if err != nil {
		return fmt.Errorf("share playlist: %w", err)
	}
	return nil
}

// ShareDelete revokes a user share.
func ShareDelete(ctx context.Context, q auth.Queries, playlistID, userID string) error {
	_, err := q.ExecContext(ctx,
		`DELETE FROM playlist_shares WHERE playlist_id = ? AND user_id = ?`, playlistID, userID)
	if err != nil {
		return fmt.Errorf("unshare playlist: %w", err)
	}
	return nil
}

// ShareEntries lists a playlist's shares joined with usernames (owner
// detail view).
func ShareEntries(ctx context.Context, q auth.Queries, playlistID string) ([]ShareEntry, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT ps.user_id, u.username, ps.can_edit
		FROM playlist_shares ps JOIN users u ON u.id = ps.user_id
		WHERE ps.playlist_id = ?
		ORDER BY u.username`, playlistID)
	if err != nil {
		return nil, fmt.Errorf("list playlist shares: %w", err)
	}
	defer rows.Close()
	out := []ShareEntry{}
	for rows.Next() {
		var e ShareEntry
		var canEdit int
		if err := rows.Scan(&e.UserID, &e.Username, &canEdit); err != nil {
			return nil, fmt.Errorf("list playlist shares: %w", err)
		}
		e.CanEdit = canEdit == 1
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list playlist shares: %w", err)
	}
	return out, nil
}

// EnableShareLink moves a playlist to visibility=link with exactly token.
// Called with a freshly minted token (create + regenerate share-link).
func EnableShareLink(ctx context.Context, q auth.Queries, playlistID, token string) error {
	_, err := q.ExecContext(ctx, `
		UPDATE playlists SET visibility = 'link', share_token = ?, updated_at = datetime('now')
		WHERE id = ?`, token, playlistID)
	if err != nil {
		return fmt.Errorf("enable share link: %w", err)
	}
	return nil
}

// DisableShareLink moves a playlist back to private and clears its token:
// the ONE lifecycle rule — a token exists iff visibility == 'link'.
func DisableShareLink(ctx context.Context, q auth.Queries, playlistID string) error {
	_, err := q.ExecContext(ctx, `
		UPDATE playlists SET visibility = 'private', share_token = NULL, updated_at = datetime('now')
		WHERE id = ?`, playlistID)
	if err != nil {
		return fmt.Errorf("disable share link: %w", err)
	}
	return nil
}

// UserExists reports whether a user id exists (share target validation).
func UserExists(ctx context.Context, q auth.Queries, userID string) (bool, error) {
	var one int
	err := q.QueryRowContext(ctx, `SELECT 1 FROM users WHERE id = ?`, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("user lookup: %w", err)
	}
	return true, nil
}

// HideExplicit reports the viewer's explicit-content preference; anonymous
// viewers get false (v1 parity: no preference, no filtering).
func HideExplicit(ctx context.Context, q auth.Queries, userID string) (bool, error) {
	if userID == "" {
		return false, nil
	}
	var flag int
	err := q.QueryRowContext(ctx, `SELECT hide_explicit FROM users WHERE id = ?`, userID).Scan(&flag)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load hide_explicit: %w", err)
	}
	return flag == 1, nil
}

// newPlaylistID mints a playlist id.
func newPlaylistID() string { return uuid.NewString() }
