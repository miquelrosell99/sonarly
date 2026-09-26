// Package players is the now-playing tracker (P8). Every stream request
// records a heartbeat into an in-memory registry keyed by user + device;
// GET /api/players exposes the live set.
//
// Deviations from the retired server, deliberate and documented:
//
//   - the old tracker only saw OpenSubsonic client streams (the hook lived in
//     the subsonic retrieval path). The Go server hooks the playback service itself,
//     so EVERY stream — native web player, API-key clients, share-token
//     guests, and (in P9) the OpenSubsonic adapter — is counted. This is
//     the audit's explicit ask.
//   - The key is user + device (the client query parameter, else the user
//     agent's first product token), so one user on two devices produces two
//     entries; the retired server keyed by user alone and the second device clobbered the
//     first.
//   - Artist/album names resolve at read time in two batched queries
//     (old ran two queries per recorded stream). Entries store ids only.
//   - The registry is in-memory and process-local, like old: a restart
//     clears it, and TTL expiry is lazy (on read or write).
package players

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/playback"
)

// TTL is how long an entry survives without a matching stream (the old 
// PLAYER_TTL_MS).
const TTL = 5 * time.Minute

// PlayerInfo is one live player entry (the old PlayerInfo shape). The raw
// artist/album ids ride along unexported: the JSON keeps the old names-only
// contract while GET /api/players resolves names in batched queries.
type PlayerInfo struct {
	ID              string  `json:"id"`
	UserID          string  `json:"userId,omitempty"`
	ClientID        string  `json:"clientId"`
	SongID          string  `json:"songId"`
	SongTitle       string  `json:"songTitle"`
	ArtistName      *string `json:"artistName,omitempty"`
	AlbumName       *string `json:"albumName,omitempty"`
	DurationSeconds *int    `json:"durationSeconds,omitempty"`
	StartedAt       string  `json:"startedAt"`
	UpdatedAt       string  `json:"updatedAt"`

	artistID string
	albumID  string
}

// Tracker is the in-memory registry. It implements playback.Recorder via
// RecordStream; main.go registers it with the playback service so every
// stream lands here without an import cycle (playback defines the
// interface, players provides the implementation).
type Tracker struct {
	mu      sync.Mutex
	players map[string]PlayerInfo
	now     func() time.Time
}

func NewTracker() *Tracker {
	return &Tracker{players: map[string]PlayerInfo{}, now: time.Now}
}

// SetClock overrides the time source (TTL math); tests use it to simulate
// expiry. Production code leaves the default.
func (t *Tracker) SetClock(now func() time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if now == nil {
		now = time.Now
	}
	t.now = now
}

// clientID derives the device key the way the old getClientId did: the `c`
// query parameter wins, else the user agent's first product token, else
// "unknown".
func clientID(r *http.Request) string {
	if c := r.URL.Query().Get("c"); c != "" {
		return c
	}
	if ua := r.UserAgent(); ua != "" {
		if product, _, ok := strings.Cut(ua, " "); ok && product != "" {
			return product
		}
		return ua
	}
	return "unknown"
}

// RecordStream implements the playback recorder hook: one entry per
// user + device, refreshed on every stream, preserving the original
// StartedAt. Anonymous share-token streams record with an empty UserID.
func (t *Tracker) RecordStream(r *http.Request, userID string, ev playback.StreamEvent) {
	device := clientID(r)
	key := userID + "|" + device
	now := t.now().UTC()

	t.mu.Lock()
	defer t.mu.Unlock()
	existing, ok := t.players[key]
	if !ok || t.expired(existing, now) {
		existing = PlayerInfo{ID: key, UserID: userID, ClientID: device, StartedAt: now.Format(time.RFC3339Nano)}
	}
	existing.SongID = ev.SongID
	existing.SongTitle = ev.Title
	existing.artistID = deref(ev.ArtistID)
	existing.albumID = deref(ev.AlbumID)
	existing.ArtistName = nil
	existing.AlbumName = nil
	existing.DurationSeconds = ev.Duration
	existing.UpdatedAt = now.Format(time.RFC3339Nano)
	t.players[key] = existing
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (t *Tracker) expired(p PlayerInfo, now time.Time) bool {
	updatedAt, err := time.Parse(time.RFC3339Nano, p.UpdatedAt)
	return err != nil || now.Sub(updatedAt) > TTL
}

// Active returns the live player set with artist/album names resolved in
// two batched queries (never per-player), expired entries pruned lazily.
func (t *Tracker) Active(ctx context.Context, db *sql.DB) ([]PlayerInfo, error) {
	now := t.now().UTC()
	t.mu.Lock()
	players := make([]PlayerInfo, 0, len(t.players))
	for key, p := range t.players {
		if t.expired(p, now) {
			delete(t.players, key)
			continue
		}
		players = append(players, p)
	}
	t.mu.Unlock()

	artistIDs, albumIDs := distinctIDs(players)
	artistNames, err := resolveNames(ctx, db, "artists", artistIDs)
	if err != nil {
		return nil, err
	}
	albumNames, err := resolveNames(ctx, db, "albums", albumIDs)
	if err != nil {
		return nil, err
	}
	for i := range players {
		if name, ok := artistNames[players[i].artistID]; ok {
			players[i].ArtistName = &name
		}
		if name, ok := albumNames[players[i].albumID]; ok {
			players[i].AlbumName = &name
		}
	}
	return players, nil
}

// Count reports the live entry count (tests and observability).
func (t *Tracker) Count() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.players)
}

// distinctIDs collects the unique artist/album ids across live entries.
func distinctIDs(players []PlayerInfo) (artists []string, albums []string) {
	seenA, seenB := map[string]struct{}{}, map[string]struct{}{}
	for _, p := range players {
		if p.artistID != "" {
			if _, ok := seenA[p.artistID]; !ok {
				seenA[p.artistID] = struct{}{}
				artists = append(artists, p.artistID)
			}
		}
		if p.albumID != "" {
			if _, ok := seenB[p.albumID]; !ok {
				seenB[p.albumID] = struct{}{}
				albums = append(albums, p.albumID)
			}
		}
	}
	return artists, albums
}

// resolveNames loads id → name for one entity table in ONE batched query
// (chunked only above the driver's parameter ceiling), which keeps
// /api/players at a flat statement count no matter the player count.
func resolveNames(ctx context.Context, db *sql.DB, table string, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	const chunk = 400
	for i := 0; i < len(ids); i += chunk {
		part := ids[i:min(i+chunk, len(ids))]
		placeholders := ""
		args := make([]any, len(part))
		for j, id := range part {
			if j > 0 {
				placeholders += ", "
			}
			placeholders += "?"
			args[j] = id
		}
		rows, err := db.QueryContext(ctx,
			fmt.Sprintf(`SELECT id, name FROM %s WHERE id IN (%s)`, table, placeholders), args...)
		if err != nil {
			return nil, fmt.Errorf("resolve %s names: %w", table, err)
		}
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err != nil {
				rows.Close()
				return nil, fmt.Errorf("resolve %s names: %w", table, err)
			}
			out[id] = name
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("resolve %s names: %w", table, err)
		}
	}
	return out, nil
}
