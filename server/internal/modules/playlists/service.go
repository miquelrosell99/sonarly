package playlists

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/miquelrosell99/sonarly/server/internal/db"
	"strings"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// Service is the playlists domain API: CRUD, shares, link lifecycle,
// resolution (static ordering + smart compilation), and the viewer-scoped
// song lists. Layering follows the v2 convention (routes → service →
// repository); the single access decision lives in Resolve, consulted here.
type Service struct {
	db     *sql.DB
	policy *Policy
}

// NewService wires the playlists service. policy may be nil (routes then
// answer token questions negatively), but production always passes
// NewPolicy().
func NewService(db *sql.DB, policy *Policy) *Service {
	return &Service{db: db, policy: policy}
}

// Input is the create body: presence of Rules makes the playlist smart.
type Input struct {
	Name        string
	Description string
	Visibility  string // "" defaults to private
	SongIDs     []string
	Rules       *Rules
	ResolveMode string // "" defaults to tracks
}

// UpdateInput is the PUT body; nil fields keep the existing value.
type UpdateInput struct {
	Name        *string
	Description *string
	Visibility  *string
	SongIDs     *[]string
	IsSmart     *bool
	Rules       *Rules
	ResolveMode *string
	// ReconcileShareToken selects the Subsonic adapter's token semantics
	// (v1 opensubsonic-routes.ts updatePlaylist): on every adapter update
	// the token is re-derived from the RESOLVED visibility — link keeps or
	// mints a token, any other visibility clears it. The native route
	// leaves this false: v1's management PUT never clears the token and
	// only auto-mints when visibility becomes 'link' with none set.
	ReconcileShareToken bool
}

// rulesUserID picks the user the user-scoped rule fields resolve against
// (v1 migration 048 semantics): 'query' mode resolves live against the
// viewer's own data; 'tracks' (default) resolves against the owner's data
// so every viewer receives the same curated list. Anonymous viewers fall
// back to the owner.
func rulesUserID(p *Playlist, viewerUserID string) string {
	if p.ResolveMode == ResolveModeQuery && viewerUserID != "" {
		return viewerUserID
	}
	return p.OwnerID
}

// List answers GET /api/playlists: own + public + shared-with-me.
// ShareToken rides only the owner's items (v1 B10 fix); smart playlists
// report their resolved count, static playlists their raw member count
// (list-view counts are not library-scope filtered — the detail view is;
// see Get).
func (s *Service) List(ctx context.Context, id auth.Identity) ([]ListItem, error) {
	rows, err := ListVisible(ctx, s.db, id.UserID)
	if err != nil {
		return nil, err
	}
	items := make([]ListItem, 0, len(rows))
	for _, r := range rows {
		p := r.playlist
		count := r.songCount
		if p.IsSmart {
			n, err := s.resolveCount(ctx, &p, id.UserID)
			if err != nil {
				return nil, err
			}
			count = n
		}
		item := ListItem{
			ID:            p.ID,
			Name:          p.Name,
			Description:   p.Description,
			OwnerID:       p.OwnerID,
			OwnerUsername: p.OwnerUsername,
			Visibility:    p.Visibility,
			IsSmart:       p.IsSmart,
			ResolveMode:   p.ResolveMode,
			SongCount:     count,
			Starred:       r.starred,
			Rating:        r.rating,
			CreatedAt:     p.CreatedAt,
			UpdatedAt:     p.UpdatedAt,
		}
		if p.OwnerID == id.UserID {
			item.ShareToken = p.ShareToken
		}
		items = append(items, item)
	}
	return items, nil
}

// Get answers GET /api/playlists/{id}. Access == none is answered
// ErrNotFound so inaccessible ids cannot be probed (404, not 403).
// identity may be the zero value (anonymous callers reach this through the
// service with a share token; the native route stays behind RequireAuth).
func (s *Service) Get(ctx context.Context, id auth.Identity, playlistID, shareToken string) (*Detail, error) {
	p, err := GetByID(ctx, s.db, playlistID)
	if err != nil {
		return nil, err
	}
	access, err := Resolve(ctx, s.db, p, id, shareToken)
	if err != nil {
		return nil, err
	}
	if access == AccessNone && shareToken != "" && p.ShareToken != "" && shareToken == p.ShareToken {
		// v1 management canViewPlaylist (P10 decision): a matching share
		// token grants VIEW regardless of the playlist's visibility — the
		// native metadata view intentionally preserves this v1 divergence;
		// the streaming/content grants and the Subsonic adapter's
		// getPlaylist keep the stricter visibility='link' + token check
		// (see doc.go). Unified cleanup is a post-cutover candidate.
		access = AccessView
	}
	if access == AccessNone {
		return nil, ErrNotFound
	}

	ids, err := s.resolveSongIDs(ctx, p, id.UserID)
	if err != nil {
		return nil, err
	}
	// Library-scope filtering: plain viewers see only their in-scope
	// subset. The owner sees the playlist as curated, editors manage it
	// unfiltered (rewriting it scoped would silently drop members), and
	// anonymous share-token viewers are authorized against the linked
	// playlist's own content — library scope applies to signed-in users
	// only (v1 /api/stream parity).
	if id.UserID != "" && access == AccessView {
		scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
		if err != nil {
			return nil, err
		}
		ids, err = filterIDsByScope(ctx, s.db, scope, ids)
		if err != nil {
			return nil, err
		}
	}

	hideExplicit, err := HideExplicit(ctx, s.db, id.UserID)
	if err != nil {
		return nil, err
	}
	entries, err := s.fetchEntries(ctx, ids, hideExplicit)
	if err != nil {
		return nil, err
	}

	detail := &Detail{
		ID:            p.ID,
		Name:          p.Name,
		Description:   p.Description,
		OwnerID:       p.OwnerID,
		OwnerUsername: p.OwnerUsername,
		Visibility:    p.Visibility,
		IsSmart:       p.IsSmart,
		ResolveMode:   p.ResolveMode,
		SongCount:     len(entries),
		Entries:       entries,
		CreatedAt:     p.CreatedAt,
		UpdatedAt:     p.UpdatedAt,
	}
	if access == AccessOwner {
		detail.ShareToken = p.ShareToken
		shares, err := ShareEntries(ctx, s.db, p.ID)
		if err != nil {
			return nil, err
		}
		// v1 emits the shares key for the owner even when empty ([]) —
		// never omit it (P10 parity finding).
		if shares == nil {
			shares = []ShareEntry{}
		}
		detail.Shares = &shares
	}
	if id.UserID != "" {
		starred, rating, err := s.interaction(ctx, id.UserID, p.ID)
		if err != nil {
			return nil, err
		}
		detail.Starred = starred
		detail.Rating = rating
	}
	return detail, nil
}

// Create answers POST /api/playlists: one transaction for the row and the
// members. Invalid song ids abort before anything is inserted (400 listing
// the offenders). Presence of Rules makes the playlist smart.
func (s *Service) Create(ctx context.Context, id auth.Identity, in Input) (*Detail, error) {
	if strings.TrimSpace(in.Name) == "" {
		return nil, rulesErrorf("name is required")
	}
	visibility := in.Visibility
	if visibility == "" {
		visibility = "private"
	}
	if !IsVisibility(visibility) {
		return nil, rulesErrorf("invalid visibility %q", in.Visibility)
	}
	if in.ResolveMode != "" && !IsResolveMode(in.ResolveMode) {
		return nil, rulesErrorf("invalid resolveMode %q", in.ResolveMode)
	}

	p := &Playlist{
		ID:          newPlaylistID(),
		Name:        in.Name,
		Description: in.Description,
		OwnerID:     id.UserID,
		Visibility:  visibility,
		IsSmart:     in.Rules != nil,
		Rules:       in.Rules,
		ResolveMode: NormalizeResolveMode(in.ResolveMode),
	}
	members := []string(nil)
	if p.IsSmart {
		if _, err := Compile(ctx, s.db, p.Rules, id.UserID); err != nil {
			return nil, err
		}
	} else {
		valid, err := s.validateSongIDs(ctx, id, in.SongIDs)
		if err != nil {
			return nil, err
		}
		members = valid
	}
	if visibility == "link" {
		token, err := MintShareToken()
		if err != nil {
			return nil, err
		}
		p.ShareToken = token
	}
	if err := Create(ctx, s.db, p, members); err != nil {
		return nil, err
	}
	return s.Get(ctx, id, p.ID, "")
}

// Update answers PUT /api/playlists/{id}: edit access required, member
// rewrites run in ONE transaction (v1 B3 fix), and smart/static conversion
// follows v1 semantics (converting to smart drops the manual members;
// converting to static materializes the current resolution).
func (s *Service) Update(ctx context.Context, id auth.Identity, playlistID string, in UpdateInput) (*Detail, error) {
	existing, err := GetByID(ctx, s.db, playlistID)
	if err != nil {
		return nil, err
	}
	access, err := Resolve(ctx, s.db, existing, id, "")
	if err != nil {
		return nil, err
	}
	if access == AccessNone {
		return nil, ErrNotFound
	}
	if access < AccessEdit {
		return nil, ErrForbidden
	}

	updated := *existing
	if in.Name != nil && *in.Name != "" {
		updated.Name = *in.Name
	}
	if in.Description != nil {
		updated.Description = *in.Description
	}
	if in.ResolveMode != nil {
		if !IsResolveMode(*in.ResolveMode) {
			return nil, rulesErrorf("invalid resolveMode %q", *in.ResolveMode)
		}
		updated.ResolveMode = *in.ResolveMode
	}

	rewriteMembers := false
	var songIDs []string
	switch {
	case updated.IsSmart && in.IsSmart != nil && !*in.IsSmart:
		// Smart → static: materialize the current resolution as members.
		updated.IsSmart = false
		updated.Rules = nil
		ids, err := s.resolveSongIDs(ctx, existing, id.UserID)
		if err != nil {
			return nil, err
		}
		songIDs = ids
		rewriteMembers = true
	case !updated.IsSmart && in.IsSmart != nil && *in.IsSmart:
		// Static → smart: rules are required; manual members are dropped.
		if in.Rules == nil {
			return nil, rulesErrorf("rules are required when converting to a smart playlist")
		}
		if _, err := Compile(ctx, s.db, in.Rules, id.UserID); err != nil {
			return nil, err
		}
		updated.IsSmart = true
		updated.Rules = in.Rules
		songIDs = nil
		rewriteMembers = true
	default:
		if updated.IsSmart {
			if in.SongIDs != nil {
				return nil, rulesErrorf("cannot manually edit songs of a smart playlist")
			}
			if in.Rules != nil {
				if _, err := Compile(ctx, s.db, in.Rules, id.UserID); err != nil {
					return nil, err
				}
				updated.Rules = in.Rules
			}
		} else if in.SongIDs != nil {
			valid, err := s.validateSongIDs(ctx, id, *in.SongIDs)
			if err != nil {
				return nil, err
			}
			songIDs = valid
			rewriteMembers = true
		}
	}

	if in.Visibility != nil {
		if !IsVisibility(*in.Visibility) {
			return nil, rulesErrorf("invalid visibility %q", *in.Visibility)
		}
		updated.Visibility = *in.Visibility
	}
	// v1 parity (P10 decision): the token lifecycle is independent of
	// visibility. Native PUT (v1 management-routes.ts) never clears the
	// token and only auto-mints when visibility becomes 'link' with none
	// set. The Subsonic adapter instead re-derives the token from the
	// resolved visibility on every update (link keeps/mints, anything
	// else clears) — v1 opensubsonic-routes.ts updatePlaylist.
	if updated.Visibility == "link" && updated.ShareToken == "" {
		token, err := MintShareToken()
		if err != nil {
			return nil, err
		}
		updated.ShareToken = token
	} else if in.ReconcileShareToken && updated.Visibility != "link" {
		updated.ShareToken = ""
	}

	if err := Update(ctx, s.db, &updated, songIDs, rewriteMembers); err != nil {
		return nil, err
	}
	return s.Get(ctx, id, playlistID, "")
}

// Delete answers DELETE /api/playlists/{id}: owner only.
func (s *Service) Delete(ctx context.Context, id auth.Identity, playlistID string) error {
	existing, err := GetByID(ctx, s.db, playlistID)
	if err != nil {
		return err
	}
	access, err := Resolve(ctx, s.db, existing, id, "")
	if err != nil {
		return err
	}
	if access == AccessNone {
		return ErrNotFound
	}
	if access != AccessOwner {
		return ErrForbidden
	}
	return Delete(ctx, s.db, playlistID)
}

// Share answers POST /api/playlists/{id}/share: owner only.
func (s *Service) Share(ctx context.Context, id auth.Identity, playlistID, targetUserID string, canEdit bool) error {
	existing, err := GetByID(ctx, s.db, playlistID)
	if err != nil {
		return err
	}
	access, err := Resolve(ctx, s.db, existing, id, "")
	if err != nil {
		return err
	}
	if access == AccessNone {
		return ErrNotFound
	}
	if access != AccessOwner {
		return ErrForbidden
	}
	if ok, err := UserExists(ctx, s.db, targetUserID); err != nil {
		return err
	} else if !ok {
		return rulesErrorf("user %q not found", targetUserID)
	}
	return ShareUpsert(ctx, s.db, playlistID, targetUserID, canEdit)
}

// Unshare answers DELETE /api/playlists/{id}/share/{userId}: owner only.
func (s *Service) Unshare(ctx context.Context, id auth.Identity, playlistID, targetUserID string) error {
	existing, err := GetByID(ctx, s.db, playlistID)
	if err != nil {
		return err
	}
	access, err := Resolve(ctx, s.db, existing, id, "")
	if err != nil {
		return err
	}
	if access == AccessNone {
		return ErrNotFound
	}
	if access != AccessOwner {
		return ErrForbidden
	}
	return ShareDelete(ctx, s.db, playlistID, targetUserID)
}

// CreateShareLink answers POST /api/playlists/{id}/share-link: owner only.
// Always mints a FRESH token — this doubles as "regenerate", killing any
// previously shared link. v1 parity: the playlist's visibility is NOT
// changed here; the token works independently of visibility.
func (s *Service) CreateShareLink(ctx context.Context, id auth.Identity, playlistID string) (string, error) {
	existing, err := GetByID(ctx, s.db, playlistID)
	if err != nil {
		return "", err
	}
	access, err := Resolve(ctx, s.db, existing, id, "")
	if err != nil {
		return "", err
	}
	if access == AccessNone {
		return "", ErrNotFound
	}
	if access != AccessOwner {
		return "", ErrForbidden
	}
	token, err := MintShareToken()
	if err != nil {
		return "", err
	}
	if err := EnableShareLink(ctx, s.db, playlistID, token); err != nil {
		return "", err
	}
	return token, nil
}

// DeleteShareLink answers DELETE /api/playlists/{id}/share-link: owner
// only. Clears the token ONLY — visibility is left exactly as it was (v1
// management-routes.ts: share_token = NULL, no visibility write).
func (s *Service) DeleteShareLink(ctx context.Context, id auth.Identity, playlistID string) error {
	existing, err := GetByID(ctx, s.db, playlistID)
	if err != nil {
		return err
	}
	access, err := Resolve(ctx, s.db, existing, id, "")
	if err != nil {
		return err
	}
	if access == AccessNone {
		return ErrNotFound
	}
	if access != AccessOwner {
		return ErrForbidden
	}
	return DisableShareLink(ctx, s.db, playlistID)
}

// resolveSongIDs returns the playlist's song ids in playing order: the
// stored member list for static playlists, the compiled rules for smart
// ones. User-scoped fields resolve against rulesUserID (owner for 'tracks',
// the viewer for 'query').
func (s *Service) resolveSongIDs(ctx context.Context, p *Playlist, viewerUserID string) ([]string, error) {
	if !p.IsSmart {
		return SongIDs(ctx, s.db, p.ID)
	}
	compiled, err := Compile(ctx, s.db, p.Rules, rulesUserID(p, viewerUserID))
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, compiled.IDsSQL, compiled.Params...)
	if err != nil {
		return nil, fmt.Errorf("resolve smart playlist: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("resolve smart playlist: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("resolve smart playlist: %w", err)
	}
	return ids, nil
}

// resolveCount reports the smart playlist's resolved size for the list
// view (limit-aware, per v1 resolvePlaylistSongCount).
func (s *Service) resolveCount(ctx context.Context, p *Playlist, viewerUserID string) (int, error) {
	compiled, err := Compile(ctx, s.db, p.Rules, rulesUserID(p, viewerUserID))
	if err != nil {
		return 0, err
	}
	var n int
	if err := s.db.QueryRowContext(ctx, compiled.CountSQL, compiled.CountParams...).Scan(&n); err != nil {
		return 0, fmt.Errorf("count smart playlist: %w", err)
	}
	return n, nil
}

// validateSongIDs checks that every id exists, is active, and sits inside
// the caller's library scope; the returned list is deduplicated in first-
// occurrence order. The error lists every offending id (v2 contract: one
// bad id means nothing is inserted).
func (s *Service) validateSongIDs(ctx context.Context, id auth.Identity, songIDs []string) ([]string, error) {
	seen := make(map[string]bool, len(songIDs))
	unique := make([]string, 0, len(songIDs))
	for _, sid := range songIDs {
		if !seen[sid] {
			seen[sid] = true
			unique = append(unique, sid)
		}
	}
	if len(unique) == 0 {
		return unique, nil
	}
	scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	found := make(map[string]bool, len(unique))
	const chunk = 500
	for i := 0; i < len(unique); i += chunk {
		part := unique[i:min(i+chunk, len(unique))]
		placeholders := make([]string, len(part))
		args := make([]any, 0, len(part))
		for j, sid := range part {
			placeholders[j] = "?"
			args = append(args, sid)
		}
		rows, err := s.db.QueryContext(ctx,
			`SELECT s.id FROM songs s WHERE s.id IN (`+strings.Join(placeholders, ", ")+
				`) AND s.active = 1 `+scopeCond.SQL,
			append(args, scopeCond.Params...)...)
		if err != nil {
			return nil, fmt.Errorf("validate song ids: %w", err)
		}
		for rows.Next() {
			var sid string
			if err := rows.Scan(&sid); err != nil {
				rows.Close()
				return nil, fmt.Errorf("validate song ids: %w", err)
			}
			found[sid] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("validate song ids: %w", err)
		}
	}
	invalid := []string{}
	for _, sid := range unique {
		if !found[sid] {
			invalid = append(invalid, sid)
		}
	}
	if len(invalid) > 0 {
		return nil, rulesErrorf("unknown or inaccessible song ids: %s", strings.Join(invalid, ", "))
	}
	return unique, nil
}

// filterIDsByScope keeps only ids reachable under the scope, preserving the
// input order (the playlist's playing order).
func filterIDsByScope(ctx context.Context, q auth.Queries, scope libraries.Scope, ids []string) ([]string, error) {
	if scope.All || len(ids) == 0 {
		return ids, nil
	}
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	found := make(map[string]bool, len(ids))
	const chunk = 500
	for i := 0; i < len(ids); i += chunk {
		part := ids[i:min(i+chunk, len(ids))]
		placeholders := make([]string, len(part))
		args := make([]any, 0, len(part))
		for j, sid := range part {
			placeholders[j] = "?"
			args = append(args, sid)
		}
		rows, err := q.QueryContext(ctx,
			`SELECT s.id FROM songs s WHERE s.id IN (`+strings.Join(placeholders, ", ")+`) `+scopeCond.SQL,
			append(args, scopeCond.Params...)...)
		if err != nil {
			return nil, fmt.Errorf("filter playlist scope: %w", err)
		}
		for rows.Next() {
			var sid string
			if err := rows.Scan(&sid); err != nil {
				rows.Close()
				return nil, fmt.Errorf("filter playlist scope: %w", err)
			}
			found[sid] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("filter playlist scope: %w", err)
		}
	}
	out := make([]string, 0, len(ids))
	for _, sid := range ids {
		if found[sid] {
			out = append(out, sid)
		}
	}
	return out, nil
}

// fetchEntries loads the display rows for ids in playlist order (v1's
// fetchPlaylistSongs shape), chunked to stay under SQLite's variable limit,
// with song artists batch-attached. Songs that are inactive or explicitly
// hidden drop out; created is the mtime as an ISO timestamp (v1 parity).
func (s *Service) fetchEntries(ctx context.Context, ids []string, hideExplicit bool) ([]Entry, error) {
	byID := make(map[string]*Entry, len(ids))
	const chunk = 500
	for i := 0; i < len(ids); i += chunk {
		part := ids[i:min(i+chunk, len(ids))]
		placeholders := make([]string, len(part))
		args := make([]any, len(part))
		for j, sid := range part {
			placeholders[j] = "?"
			args[j] = sid
		}
		rows, err := s.db.QueryContext(ctx, `
			SELECT s.id, s.title, s.track_number, s.disc_number, s.duration, s.genre, s.year,
			       s.explicit, s.mtime, s.cover_art_id, s.album_id, a.name, a.cover_art_id,
			       s.artist_id, ar.name
			FROM songs s
			LEFT JOIN albums a ON a.id = s.album_id
			LEFT JOIN artists ar ON ar.id = s.artist_id
			WHERE s.active = 1 AND s.id IN (`+strings.Join(placeholders, ", ")+`)`, args...)
		if err != nil {
			return nil, fmt.Errorf("load playlist entries: %w", err)
		}
		for rows.Next() {
			var e Entry
			var track, disc, year, explicit sql.NullInt64
			var duration db.NullInt64 // v1 may have stored fractional REAL seconds
			var mtime db.NullInt64
			var genre, coverArt, albumID, albumName, albumCoverArt, artistID, artistName sql.NullString
			if err := rows.Scan(&e.ID, &e.Title, &track, &disc, &duration, &genre, &year,
				&explicit, &mtime, &coverArt, &albumID, &albumName, &albumCoverArt,
				&artistID, &artistName); err != nil {
				rows.Close()
				return nil, fmt.Errorf("load playlist entries: %w", err)
			}
			if track.Valid {
				e.Track = intPtr(int(track.Int64))
			}
			if disc.Valid {
				e.DiscNumber = intPtr(int(disc.Int64))
			}
			if v, ok := duration.Value(); ok {
				e.Duration = intPtr(int(v))
			}
			if year.Valid {
				e.Year = intPtr(int(year.Int64))
			}
			e.Explicit = explicit.Valid && explicit.Int64 == 1
			if genre.Valid {
				e.Genre = &genre.String
			}
			if coverArt.Valid {
				e.CoverArt = &coverArt.String
			}
			if albumID.Valid {
				e.AlbumID = &albumID.String
			}
			if albumName.Valid {
				e.Album = albumName.String
			}
			if albumCoverArt.Valid {
				e.AlbumCoverArt = &albumCoverArt.String
			}
			if artistID.Valid {
				e.ArtistID = &artistID.String
			}
			if artistName.Valid {
				e.Artist = artistName.String
			}
			e.Type = "music"
			if v, ok := mtime.Value(); ok {
				e.Created = time.UnixMilli(v).UTC().Format(time.RFC3339)
			}
			byID[e.ID] = &e
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("load playlist entries: %w", err)
		}
		rows.Close()
	}
	if err := s.attachArtists(ctx, byID); err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(ids))
	for _, sid := range ids {
		if e, ok := byID[sid]; ok && (!hideExplicit || !e.Explicit) {
			entries = append(entries, *e)
		}
	}
	return entries, nil
}

// attachArtists batch-attaches song_artists entries (v1's
// attachSongArtistEntries): one chunked junction query for the whole list,
// never one per song.
func (s *Service) attachArtists(ctx context.Context, byID map[string]*Entry) error {
	if len(byID) == 0 {
		return nil
	}
	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	attached := make(map[string][]NameEntry)
	const chunk = 500
	for i := 0; i < len(ids); i += chunk {
		part := ids[i:min(i+chunk, len(ids))]
		placeholders := make([]string, len(part))
		args := make([]any, len(part))
		for j, sid := range part {
			placeholders[j] = "?"
			args[j] = sid
		}
		rows, err := s.db.QueryContext(ctx, `
			SELECT j.song_id, e.id, e.name
			FROM song_artists j JOIN artists e ON e.id = j.artist_id
			WHERE j.song_id IN (`+strings.Join(placeholders, ", ")+`)
			ORDER BY j.song_id, j.position`, args...)
		if err != nil {
			return fmt.Errorf("attach playlist artists: %w", err)
		}
		for rows.Next() {
			var songID string
			var e NameEntry
			if err := rows.Scan(&songID, &e.ID, &e.Name); err != nil {
				rows.Close()
				return fmt.Errorf("attach playlist artists: %w", err)
			}
			attached[songID] = append(attached[songID], e)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("attach playlist artists: %w", err)
		}
		rows.Close()
	}
	for id, entries := range attached {
		e := byID[id]
		e.ArtistEntries = entries
		names := make([]string, len(entries))
		for i, entry := range entries {
			names[i] = entry.Name
		}
		e.Artists = names
	}
	return nil
}

// interaction loads the viewer's starred/rating for the playlist.
func (s *Service) interaction(ctx context.Context, userID, playlistID string) (bool, *float64, error) {
	var starred sql.NullInt64
	var rating sql.NullFloat64
	err := s.db.QueryRowContext(ctx,
		`SELECT starred, rating FROM user_playlists WHERE user_id = ? AND playlist_id = ?`,
		userID, playlistID).Scan(&starred, &rating)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, fmt.Errorf("load playlist interaction: %w", err)
	}
	var r *float64
	if rating.Valid {
		f := rating.Float64
		r = &f
	}
	return starred.Valid && starred.Int64 == 1, r, nil
}

func intPtr(v int) *int { return &v }
