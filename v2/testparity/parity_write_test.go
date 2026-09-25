package testparity

// The write phase of the parity matrix: runs AFTER the DB snapshot on both
// servers (the snapshot is taken between the read and write phases on the
// v1 run, so both servers replay writes from the same starting state).
// Includes the read-after-write verification cases.

import (
	"fmt"
)

func init() {
	writePhase := []step{
		// --------------------------- native writes ---------------------------

		{
			group: "native", name: "favorites-song", writes: true,
			notes: []Rule{noteInteractionsContract},
			call: func(c *client, w *world) (*capture, error) {
				body := map[string]any{"entityType": "song", "entityId": w.str("song.A1"), "starred": true}
				if c.v2 {
					body = map[string]any{"songId": w.str("song.A1"), "starred": true}
				}
				return c.do("POST", "/api/favorites", body, nil)
			},
		},
		{
			group: "native", name: "ratings-song", writes: true,
			notes: []Rule{noteInteractionsContract},
			call: func(c *client, w *world) (*capture, error) {
				body := map[string]any{"entityType": "song", "entityId": w.str("song.A2"), "rating": 4.5}
				if c.v2 {
					body = map[string]any{"songId": w.str("song.A2"), "rating": 4.5}
				}
				return c.do("POST", "/api/ratings", body, nil)
			},
		},
		{
			group: "native", name: "favorites-album", writes: true,
			notes: []Rule{noteInteractionsContract},
			call: func(c *client, w *world) (*capture, error) {
				body := map[string]any{"entityType": "album", "entityId": w.str("album.Dust and Ember"), "starred": true}
				if c.v2 {
					body = map[string]any{"albumId": w.str("album.Dust and Ember"), "starred": true}
				}
				return c.do("POST", "/api/favorites", body, nil)
			},
		},
		{
			group: "native", name: "favorites-artist", writes: true,
			notes: []Rule{noteInteractionsContract},
			call: func(c *client, w *world) (*capture, error) {
				body := map[string]any{"entityType": "artist", "entityId": w.str("artist.Midnight Coil"), "starred": true}
				if c.v2 {
					body = map[string]any{"artistId": w.str("artist.Midnight Coil"), "starred": true}
				}
				return c.do("POST", "/api/favorites", body, nil)
			},
		},
		{
			group: "native", name: "song-detail-after-interactions", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/songs/"+w.str("song.A1"), nil, nil)
			},
			norms: nativeSongNorms(),
		},
		{
			group: "native", name: "song-detail-after-rating", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/songs/"+w.str("song.A2"), nil, nil)
			},
			norms: nativeSongNorms(),
		},
		{
			group: "native", name: "playlist-create", writes: true,
			norms: []normRule{rulePlaylistWriteTrim},
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.do("POST", "/api/playlists", map[string]any{
					"name":    "Parity Mix",
					"songIds": []string{w.str("song.A1"), w.str("song.A2"), w.str("song.A3")},
				}, nil)
				if err == nil {
					if pl, ok := jsonBody(cap)["playlist"].(map[string]any); ok {
						w.set("playlistA.id", pl["id"], true)
					}
				}
				return cap, err
			},
			canonical: canonicalTimestamps("createdAt", "updatedAt"),
		},
		{
			group: "native", name: "playlist-get", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/playlists/"+w.str("playlistA.id"), nil, nil)
			},
			norms:     []normRule{ruleDurationSeconds, ruleScanStampMtime, rulePlaylistDetailTrim},
			canonical: canonicalTimestamps("createdAt", "updatedAt"),
		},
		{
			group: "native", name: "playlist-list", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/playlists", nil, nil)
			},
			norms:     []normRule{ruleDurationSeconds, ruleScanStampMtime},
			canonical: canonicalTimestamps("createdAt", "updatedAt"),
		},
		{
			group: "native", name: "playlist-update", writes: true,
			norms: []normRule{rulePlaylistWriteTrim},
			call: func(c *client, w *world) (*capture, error) {
				return c.do("PUT", "/api/playlists/"+w.str("playlistA.id"), map[string]any{
					"name":    "Parity Mix Renamed",
					"songIds": []string{w.str("song.A1"), w.str("song.A4")},
				}, nil)
			},
			canonical: canonicalTimestamps("createdAt", "updatedAt"),
		},
		{
			group: "native", name: "playlist-get-after-update", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/playlists/"+w.str("playlistA.id"), nil, nil)
			},
			norms:     []normRule{ruleDurationSeconds, ruleScanStampMtime, rulePlaylistDetailTrim},
			canonical: canonicalTimestamps("createdAt", "updatedAt"),
		},
		{
			group: "native", name: "playlist-share-link", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.do("POST", "/api/playlists/"+w.str("playlistA.id")+"/share-link", nil, nil)
				if err == nil {
					if tok, ok := jsonBody(cap)["shareToken"].(string); ok && tok != "" {
						w.set("playlistA.token", tok, true)
					}
				}
				return cap, err
			},
		},
		{
			group: "native", name: "playlist-anonymous-share", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				saved := c.cookie
				c.cookie = "" // anonymous: no session cookie
				cap, err := c.do("GET", "/api/playlists/"+w.str("playlistA.id")+"?shareToken="+w.str("playlistA.token"), nil, nil)
				c.cookie = saved
				if err == nil {
					if pl, ok := jsonBody(cap)["playlist"].(map[string]any); ok {
						delete(pl, "shares") // owner-only field; both runs are the owner, kept comparable below
					}
				}
				return cap, err
			},
			norms:     []normRule{ruleDurationSeconds, ruleScanStampMtime, rulePlaylistDetailTrim},
			canonical: canonicalTimestamps("createdAt", "updatedAt"),
		},
		{
			group: "native", name: "scrobble-detailed", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("POST", "/api/songs/"+w.str("song.A1")+"/scrobble", map[string]any{
					"durationListened": 42, "completion": 0.5,
					"client": "parity-native", "source": "album",
				}, nil)
			},
		},
		{
			group: "native", name: "scrobble-minimal", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("POST", "/api/songs/"+w.str("song.A4")+"/scrobble", nil, nil)
			},
		},
		{
			group: "native", name: "statistics-me-after-scrobbles", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/statistics/me", nil, nil)
			},
			compareMode: "custom",
			compare:     compareStatistics,
		},

		// ------------------------ OpenSubsonic writes ------------------------

		{
			group: "oss", name: "star-multi", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("star.view", map[string][]string{
					"id":       {w.str("song.A1")},
					"albumId":  {w.str("album.Dust and Ember")},
					"artistId": {w.str("artist.Midnight Coil")},
				}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getStarred2", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getStarred2.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getStarred", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getStarred.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "unstar-artist", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("unstar.view", map[string][]string{
					"artistId": {w.str("artist.Midnight Coil")},
				}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getStarred2-after-unstar", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getStarred2.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "setRating", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("setRating.view", map[string][]string{
					"id": {w.str("song.A3")}, "rating": {"3"},
				}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getSong-after-rating", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getSong.view", map[string][]string{"id": {w.str("song.A3")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getAlbum-starred", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getAlbum.view", map[string][]string{"id": {w.str("album.Dust and Ember")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "scrobble", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("scrobble.view", map[string][]string{"id": {w.str("song.A3")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "scrobble-submission-false-noop", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("scrobble.view", map[string][]string{
					"id": {w.str("song.A3")}, "submission": {"false"},
				}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "createPlaylist", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.restGET("createPlaylist.view", map[string][]string{
					"name": {"OSS Mix"}, "songId": {w.str("song.A4"), w.str("song.A5")},
				}, nil)
				if err == nil {
					inner := unwrapSubsonic(cap.json)
					if pl, ok := inner["playlist"].(map[string]any); ok {
						w.set("ossMix.id", pl["id"], true)
					}
				}
				return cap, err
			},
			norms:     ossNorms(ruleAdapterPlaylistCoverArt),
			canonical: canonicalTimestamps("created", "changed"),
		},
		{
			group: "oss", name: "updatePlaylist", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("updatePlaylist.view", map[string][]string{
					"playlistId":  {w.str("ossMix.id")},
					"name":        {"OSS Mix Updated"},
					"songIdToAdd": {w.str("song.A1")},
				}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getPlaylist-adapter", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getPlaylist.view", map[string][]string{"id": {w.str("ossMix.id")}}, nil)
			},
			norms:     ossNorms(ruleAdapterPlaylistCoverArt),
			canonical: canonicalTimestamps("created", "changed"),
		},
		{
			group: "oss", name: "getPlaylists-adapter", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getPlaylists.view", nil, nil)
			},
			norms:     ossNorms(ruleAdapterPlaylistCoverArtList),
			canonical: canonicalTimestamps("created", "changed"),
		},
		{
			group: "oss", name: "deletePlaylist-adapter", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("deletePlaylist.view", map[string][]string{"id": {w.str("ossMix.id")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getPlaylists-after-delete", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getPlaylists.view", nil, nil)
			},
			norms:     ossNorms(ruleAdapterPlaylistCoverArtList),
			canonical: canonicalTimestamps("created", "changed"),
		},
		{
			// One more stream under a distinct client id so getNowPlaying and
			// /api/players have a deterministic entry (tracker is keyed by
			// user, so this overwrites the earlier parity-client entry).
			group: "oss", name: "stream-for-now-playing", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("stream.view", map[string][]string{
					"id": {w.str("song.A5")}, "c": {"ParityPlayer"},
				}, nil)
			},
			compareMode: "custom",
			compare: func(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
				if v1.status != v2.status {
					return []string{fmt.Sprintf("stream status: %d vs %d", v1.status, v2.status)}, nil
				}
				if len(v1.body) == 0 || len(v2.body) == 0 {
					return []string{"empty stream body"}, nil
				}
				return nil, nil
			},
		},
		{
			group: "oss", name: "getNowPlaying", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getNowPlaying.view", nil, nil)
			},
			compareMode: "custom",
			compare:     compareNowPlaying,
		},
		{
			group: "native", name: "players-after-streams", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.do("GET", "/api/players", nil, nil)
				if err == nil {
					// v2's player id is "userId|clientId" (per-device keying)
					// vs v1's bare userId — publish for cross-run remapping.
					for _, p := range listAt(jsonBody(cap), "players") {
						if m, ok := p.(map[string]any); ok && m["clientId"] == "ParityPlayer" {
							if id, ok := m["id"].(string); ok {
								w.set("player.parity.id", id, true)
							}
						}
					}
				}
				return cap, err
			},
			compareMode: "custom",
			compare:     comparePlayers,
		},
		{
			group: "oss", name: "createBookmark", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("createBookmark.view", map[string][]string{
					"id": {w.str("song.A1")}, "position": {"15000"}, "comment": {"halfway"},
				}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getBookmarks", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getBookmarks.view", nil, nil)
			},
			norms:     ossNorms(),
			canonical: canonicalTimestamps("created", "updated", "changed"),
		},
		{
			group: "oss", name: "deleteBookmark", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("deleteBookmark.view", map[string][]string{"id": {w.str("song.A1")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getBookmarks-after-delete", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getBookmarks.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "native", name: "playlist-delete", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("DELETE", "/api/playlists/"+w.str("playlistA.id"), nil, nil)
			},
		},
		{
			group: "native", name: "playlist-list-after-delete", writes: true,
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/playlists", nil, nil)
			},
			norms:     []normRule{ruleDurationSeconds, ruleScanStampMtime, rulePlaylistDetailTrim},
			canonical: canonicalTimestamps("createdAt", "updatedAt"),
		},
	}
	allSteps = append(allSteps, writePhase...)
}

// compareNowPlaying compares the now-playing entries for the deterministic
// ParityPlayer stream. v2's tracker keys by user+device (P8) so earlier
// streams under the parity client coexist; v1 collapses per user — both
// sides are filtered to the ParityPlayer entry.
var nowPlayingKeyingNote = Rule{"P8-players-keyed-by-device", "v2's player tracker keys by user+device (P8), keeping one entry per client id; v1's tracker keys by user only and overwrites — compared filtered to the deterministic ParityPlayer entry"}

func compareNowPlaying(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	var failures []string
	pick := func(cap *capture) []any {
		inner := unwrapSubsonic(cap.json)
		np, _ := inner["nowPlaying"].(map[string]any)
		var out []any
		for _, e := range listAt(np, "entry") {
			if m, ok := e.(map[string]any); ok && m["playerName"] == "ParityPlayer" {
				out = append(out, e)
			}
		}
		return out
	}
	e1, e2 := pick(v1), pick(v2)
	if len(e1) != len(e2) {
		return []string{fmt.Sprintf("ParityPlayer entry count: %d vs %d", len(e1), len(e2))}, nil
	}
	if len(e1) == 0 {
		return []string{"no ParityPlayer now-playing entries on either side"}, nil
	}
	c1 := ruleScanStampMtime.apply(canonicalTimestamps("starred")(roundFloats(map[string]any{"entry": e1})))
	c2 := ruleScanStampMtime.apply(canonicalTimestamps("starred")(roundFloats(map[string]any{"entry": e2})))
	if ds := diff(c1, c2, 10); len(ds) > 0 {
		failures = append(failures, ds...)
	}
	return failures, []Rule{nowPlayingKeyingNote}
}

// comparePlayers compares /api/players filtered to the deterministic
// ParityPlayer stream (see compareNowPlaying for the keying deviation).
func comparePlayers(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	pick := func(cap *capture) []any {
		var out []any
		for _, p := range listAt(jsonBody(cap), "players") {
			if m, ok := p.(map[string]any); ok && m["clientId"] == "ParityPlayer" {
				out = append(out, p)
			}
		}
		return out
	}
	p1 := canonicalTimestamps("startedAt", "updatedAt")(roundFloats(map[string]any{"players": pick(v1)}))
	p2 := canonicalTimestamps("startedAt", "updatedAt")(roundFloats(map[string]any{"players": pick(v2)}))
	if ds := diff(p1, p2, 10); len(ds) > 0 {
		return ds, nil
	}
	return nil, []Rule{nowPlayingKeyingNote}
}

// statisticsHalfStar documents v1's whole-star histogram ladder.
var statisticsHalfStar = Rule{"P10-v1-half-star-histogram-drop", "v1's ratingDistribution histogram looks up exact float ratings on the whole-star ladder [1..5] — half-star ratings (4.5) are dropped entirely; v2 folds them into the integer bucket (int(4.5)=4) — buckets where v1 reports 0 tolerate v2's half-star counts"}

// compareStatistics diffs /api/statistics/me with float epsilon and
// list-order canonicalization, tolerating the half-star histogram quirk
// documented above (v1 reports 0 for buckets fed only by half-star ratings).
func compareStatistics(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	b1, b2 := jsonBody(v1), jsonBody(v2)
	strip := func(b map[string]any) any {
		c := clone(b).(map[string]any)
		if charts, ok := c["charts"].(map[string]any); ok {
			cc := clone(charts).(map[string]any)
			if rd, ok := cc["ratingDistribution"].(map[string]any); ok {
				rr := clone(rd).(map[string]any)
				delete(rr, "ratings")
				cc["ratingDistribution"] = rr
			}
			c["charts"] = cc
		}
		return c
	}
	failures := diff(
		roundFloats(sortListsByID(strip(b1))),
		roundFloats(sortListsByID(strip(b2))), 25)
	var accepted []Rule
	hist := func(b map[string]any) map[string]float64 {
		out := map[string]float64{}
		charts, _ := b["charts"].(map[string]any)
		rd, _ := charts["ratingDistribution"].(map[string]any)
		for _, item := range listAt(rd, "ratings") {
			if m, ok := item.(map[string]any); ok {
				c, _ := m["count"].(float64)
				out[fmt.Sprint(m["rating"])] = c
			}
		}
		return out
	}
	h1, h2 := hist(b1), hist(b2)
	for r, c2 := range h2 {
		c1 := h1[r]
		if c1 != c2 {
			if c1 == 0 {
				accepted = append(accepted, statisticsHalfStar)
			} else {
				failures = append(failures, fmt.Sprintf("ratingDistribution bucket %s: v1=%v v2=%v", r, c1, c2))
			}
		}
	}
	for r, c1 := range h1 {
		if _, ok := h2[r]; !ok && c1 != 0 {
			failures = append(failures, fmt.Sprintf("ratingDistribution bucket %s missing in v2 (v1=%v)", r, c1))
		}
	}
	return failures, accepted
}
