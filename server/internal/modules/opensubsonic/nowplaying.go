package opensubsonic

import (
	"context"
	"encoding/xml"
	"net/http"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Now-playing group (retired routes/now-playing.ts, quirks doc N1). Entries come
// from the P8 players tracker — the in-memory, single-process registry every
// stream (native web player included) records into. The Go server deviation carried
// over from P8: the tracker keys by user + device, so one user on two
// devices produces TWO entries where the old user-keyed map kept only the last.

// nowPlayingEntry is one getNowPlaying entry (retired now-playing.ts:19-29):
// the player metadata plus the full song child; the child embeds under the
// literal key `entry` and is omitted when the song left the catalog.
type nowPlayingEntry struct {
	Username   string `xml:"username,attr" json:"username"`
	PlayerID   string `xml:"playerId,attr" json:"playerId"`
	MinutesAgo int    `xml:"minutesAgo,attr" json:"minutesAgo"`
	PlayerName string `xml:"playerName,attr" json:"playerName"`
	Entry      *Song  `xml:"entry" json:"entry,omitempty"`
}

type nowPlayingBody struct {
	Entry []nowPlayingEntry `xml:"entry" json:"entry"`
}

type nowPlayingPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	NowPlaying nowPlayingBody `xml:"nowPlaying" json:"nowPlaying"`
}

// getNowPlaying implements getNowPlaying.view (N1): one entry per live
// player with the caller-context song child, username resolved from the
// users table, minutesAgo floored (retired: Math.max(0, Math.floor(...))).
// playerName is the tracker client id — the `c` query param, else the user
// agent's first product token, else "unknown" (P8 tracker derivation, the old
// getClientId semantics).
func (h *Handler) getNowPlaying(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, _ := auth.IdentityFrom(ctx)

	live, err := h.tracker.Active(ctx, h.db)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	songIDs := make([]string, 0, len(live))
	userIDs := make([]string, 0, len(live))
	for _, p := range live {
		songIDs = append(songIDs, p.SongID)
		if p.UserID != "" {
			userIDs = append(userIDs, p.UserID)
		}
	}
	// the retired server fetched the song children WITHOUT a library-scope filter
	// (fetchOpenSubsonicSongsByIds called with no scope); missing/inactive
	// songs drop out and their entries render without a child.
	songs, err := h.songsByIDs(ctx, id.UserID, songIDs, nil)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	songByID := make(map[string]Song, len(songs))
	for _, s := range songs {
		songByID[s.ID] = s
	}
	usernames, err := h.usernames(ctx, userIDs)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	now := time.Now()
	entries := make([]nowPlayingEntry, 0, len(live))
	for _, p := range live {
		entry := nowPlayingEntry{
			Username:   usernames[p.UserID],
			PlayerID:   p.ID,
			PlayerName: p.ClientID,
		}
		if updatedAt, err := time.Parse(time.RFC3339Nano, p.UpdatedAt); err == nil {
			entry.MinutesAgo = max(0, int(now.Sub(updatedAt)/time.Minute))
		}
		if song, ok := songByID[p.SongID]; ok {
			entry.Entry = &song
		}
		entries = append(entries, entry)
	}
	respond(w, r, nowPlayingPayload{Envelope: okEnvelope(), NowPlaying: nowPlayingBody{Entry: entries}})
}

// usernames batch-resolves user ids to usernames (one chunked query, never
// one per player). Anonymous players (empty user id) resolve to "".
func (h *Handler) usernames(ctx context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	for _, chunk := range chunkIDs(ids) {
		rows, err := h.db.QueryContext(ctx,
			`SELECT id, username FROM users WHERE id IN (`+placeholders(len(chunk))+`)`,
			stringArgs(chunk)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id, username string
			if err := rows.Scan(&id, &username); err != nil {
				rows.Close()
				return nil, err
			}
			out[id] = username
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}
