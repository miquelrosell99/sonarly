package playlists

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Access is the single playlist access level, shared by every surface.
// Higher levels imply the lower ones.
type Access int

const (
	AccessNone  Access = iota
	AccessView         // may view content
	AccessEdit         // may edit content (owner or can_edit share)
	AccessOwner        // owns: may delete, share, manage the link
)

// String names the level for logs and tests.
func (a Access) String() string {
	switch a {
	case AccessOwner:
		return "owner"
	case AccessEdit:
		return "edit"
	case AccessView:
		return "view"
	default:
		return "none"
	}
}

// Resolve is THE playlist access policy — the only implementation in the
// server, used by the native routes and (in P9) the OpenSubsonic adapter.
// v1 kept two divergent copies that disagreed on whether a share token
// required visibility=link; v2 has exactly this one, and the rule is:
//
//	owner                                    → AccessOwner
//	playlist_shares row with can_edit        → AccessEdit
//	playlist_shares row                    → AccessView
//	visibility == public                   → AccessView
//	visibility == link && shareToken match → AccessView
//	otherwise                              → AccessNone
//
// The token branch intentionally requires visibility='link': Resolve gates
// data-mutating and Subsonic-adapter paths (including getPlaylist's
// anonymous shareToken bypass). The NATIVE metadata view adds v1's looser
// canViewPlaylist rule on top — a matching token grants view regardless of
// visibility (service.Get; the P10 decision records this as an intentional
// v1 divergence). Streaming/cover-art grants couple link+token in SQL
// (TokenGrantsSong/TokenGrantsCoverArt).
// identity is the zero value for anonymous callers; shareToken is the token
// presented by the caller (query param or stream parameter), "" when none.
func Resolve(ctx context.Context, q auth.Queries, p *Playlist, identity auth.Identity, shareToken string) (Access, error) {
	if identity.UserID != "" && p.OwnerID == identity.UserID {
		return AccessOwner, nil
	}
	if identity.UserID != "" {
		var canEdit int
		err := q.QueryRowContext(ctx,
			`SELECT can_edit FROM playlist_shares WHERE playlist_id = ? AND user_id = ?`,
			p.ID, identity.UserID).Scan(&canEdit)
		if err == nil && canEdit == 1 {
			return AccessEdit, nil
		}
		if err == nil {
			return AccessView, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return AccessNone, fmt.Errorf("resolve playlist share: %w", err)
		}
	}
	if p.Visibility == "public" {
		return AccessView, nil
	}
	if p.Visibility == "link" && shareToken != "" && p.ShareToken != "" && shareToken == p.ShareToken {
		return AccessView, nil
	}
	return AccessNone, nil
}

// MintShareToken generates a new share token: 32 random bytes as hex
// (64 chars), matching the v2 lifecycle decision that a token is an opaque
// high-entropy secret rather than v1's UUID (better guess-resistance for a
// bearer token).
func MintShareToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("mint share token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// Policy answers content-granting questions for share tokens: does this
// token authorize streaming this song / fetching this cover art? It owns the
// bounded grant cache backing smart-playlist resolution (30s TTL, matching
// v1's intent, but size-capped — v1's cache was unbounded).
type Policy struct {
	grants *grantCache
}

// NewPolicy builds the token policy with the production cache bounds.
func NewPolicy() *Policy {
	return &Policy{grants: newGrantCache(128, 30*time.Second, time.Now)}
}

// TokenExists reports whether some playlist currently answers to token,
// i.e. has visibility=link with exactly this token. Anonymous streamers
// with an unknown token get 401; a known token whose playlist does not
// contain the song gets 404.
func (pol *Policy) TokenExists(ctx context.Context, q auth.Queries, token string) (bool, error) {
	var one int
	err := q.QueryRowContext(ctx,
		`SELECT 1 FROM playlists WHERE visibility = 'link' AND share_token = ? LIMIT 1`, token).
		Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("share token lookup: %w", err)
	}
	return true, nil
}

// TokenGrantsSong implements the streaming share-token grant, ported from
// v1's shareTokenGrantsSong with the same scoping guarantee: a token only
// ever authorizes content belonging to the link-shared playlist it was
// minted for. Static playlists are probed with the EXISTS-scoped SQL; smart
// playlists resolve their rules against the OWNER's data (never the
// anonymous viewer's), through the bounded grant cache.
func (pol *Policy) TokenGrantsSong(ctx context.Context, q auth.Queries, token, songID string) (bool, error) {
	var one int
	err := q.QueryRowContext(ctx, `
		SELECT 1
		FROM playlists p
		JOIN playlist_songs ps ON ps.playlist_id = p.id
		JOIN songs s ON s.id = ps.song_id AND s.active = 1
		WHERE p.visibility = 'link' AND p.share_token = ? AND ps.song_id = ?
		LIMIT 1`, token, songID).Scan(&one)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("share token song grant: %w", err)
	}

	ids, ok, err := pol.smartGrantSongIDs(ctx, q, token)
	if err != nil || !ok {
		return false, err
	}
	_, granted := ids[songID]
	return granted, nil
}

// TokenGrantsCoverArt mirrors TokenGrantsSong for cover art: the art must
// belong to a granted active song — either its own art or its album's.
// (Kept for the P9 OpenSubsonic adapter; v1's shareTokenGrantsCoverArt.)
func (pol *Policy) TokenGrantsCoverArt(ctx context.Context, q auth.Queries, token, coverArtID string) (bool, error) {
	var one int
	err := q.QueryRowContext(ctx, `
		SELECT 1
		FROM playlists p
		JOIN playlist_songs ps ON ps.playlist_id = p.id
		JOIN songs s ON s.id = ps.song_id AND s.active = 1
		LEFT JOIN albums a ON a.id = s.album_id
		WHERE p.visibility = 'link' AND p.share_token = ?
		  AND (s.cover_art_id = ? OR a.cover_art_id = ?)
		LIMIT 1`, token, coverArtID, coverArtID).Scan(&one)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("share token cover grant: %w", err)
	}

	ids, ok, err := pol.smartGrantSongIDs(ctx, q, token)
	if err != nil || !ok {
		return false, err
	}
	// Chunk the granted id set: one placeholder per song id would exceed
	// SQLite's variable limit on huge playlists (v1 parity, chunk 500).
	const chunk = 500
	list := make([]string, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	for i := 0; i < len(list); i += chunk {
		part := list[i:min(i+chunk, len(list))]
		placeholders := placeholders(len(part))
		args := make([]any, 0, len(part)+2)
		for _, id := range part {
			args = append(args, id)
		}
		args = append(args, coverArtID, coverArtID)
		err := q.QueryRowContext(ctx, `
			SELECT 1
			FROM songs s
			LEFT JOIN albums a ON a.id = s.album_id
			WHERE s.active = 1 AND s.id IN (`+placeholders+`)
			  AND (s.cover_art_id = ? OR a.cover_art_id = ?)
			LIMIT 1`, args...).Scan(&one)
		if err == nil {
			return true, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return false, fmt.Errorf("share token cover grant (smart): %w", err)
		}
	}
	return false, nil
}

// smartGrantSongIDs resolves the union of song ids granted by token across
// the link-shared SMART playlists answering to it. ok is false when no
// smart playlist carries the token. Resolution goes through the bounded
// cache keyed by playlist id + rules hash, so a rules edit invalidates
// immediately (the hash changes) while an untouched playlist reuses its
// set for up to the TTL.
func (pol *Policy) smartGrantSongIDs(ctx context.Context, q auth.Queries, token string) (ids map[string]struct{}, ok bool, err error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, owner_id, rules_json
		FROM playlists
		WHERE visibility = 'link' AND share_token = ? AND is_smart = 1`, token)
	if err != nil {
		return nil, false, fmt.Errorf("smart link playlists: %w", err)
	}
	defer rows.Close()
	type row struct {
		id, ownerID, rulesJSON string
	}
	var list []row
	for rows.Next() {
		var r row
		var rules sql.NullString
		if err := rows.Scan(&r.id, &r.ownerID, &rules); err != nil {
			return nil, false, fmt.Errorf("smart link playlists: %w", err)
		}
		if rules.Valid {
			r.rulesJSON = rules.String
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("smart link playlists: %w", err)
	}
	if len(list) == 0 {
		return nil, false, nil
	}
	out := make(map[string]struct{})
	for _, r := range list {
		set, err := pol.resolveSmartGrant(ctx, q, r.id, r.ownerID, r.rulesJSON)
		if err != nil {
			return nil, false, err
		}
		for id := range set {
			out[id] = struct{}{}
		}
	}
	return out, true, nil
}

// resolveSmartGrant compiles one smart link playlist against its owner's
// rules and returns the granted id set, consulting the cache first.
func (pol *Policy) resolveSmartGrant(ctx context.Context, q auth.Queries, playlistID, ownerID, rulesJSON string) (map[string]struct{}, error) {
	key := playlistID + ":" + rulesHash(rulesJSON)
	if cached, ok := pol.grants.get(key); ok {
		return cached, nil
	}
	ids := make(map[string]struct{})
	if rulesJSON != "" {
		rules, err := ParseRules([]byte(rulesJSON))
		if err != nil {
			// Stored rules were validated at write time; a parse failure
			// means hand-edited data. Deny rather than 500 the stream.
			return ids, nil
		}
		if rules != nil {
			compiled, err := Compile(ctx, q, rules, ownerID)
			if err != nil {
				return ids, nil
			}
			idRows, err := q.QueryContext(ctx, compiled.IDsSQL, compiled.Params...)
			if err != nil {
				return nil, fmt.Errorf("resolve smart grant: %w", err)
			}
			defer idRows.Close()
			for idRows.Next() {
				var id string
				if err := idRows.Scan(&id); err != nil {
					return nil, fmt.Errorf("resolve smart grant: %w", err)
				}
				ids[id] = struct{}{}
			}
			if err := idRows.Err(); err != nil {
				return nil, fmt.Errorf("resolve smart grant: %w", err)
			}
		}
	}
	pol.grants.set(key, ids)
	return ids, nil
}

// rulesHash fingerprints rules JSON for the cache key so an edit
// invalidates the entry immediately (v1 keyed on the raw rules_json, same
// intent).
func rulesHash(rulesJSON string) string {
	sum := sha256.Sum256([]byte(rulesJSON))
	return hex.EncodeToString(sum[:])
}

// placeholders builds "?, ?, ..." for n bound values.
func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	out := make([]byte, 0, 3*n)
	for i := 0; i < n; i++ {
		if i > 0 {
			out = append(out, ',', ' ')
		}
		out = append(out, '?')
	}
	return string(out)
}
