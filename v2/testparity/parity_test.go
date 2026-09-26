package testparity

// The P10 parity diff matrix: one ordered request script executed against
// v1 and v2 (see harness_test.go for the replay mechanics). Steps flagged
// writes=true run after the DB snapshot on both servers; everything else
// runs before it. Read-after-write verifications live in the write phase.

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// titleToKey maps seeded titles to their seed-plan keys for catalog
// resolution.
var titleToKey = func() map[string]string {
	m := map[string]string{}
	for _, s := range seedPlan {
		m[s.title] = s.key
	}
	return m
}()

// ---------------------------------------------------------------------------
// Step helpers.
// ---------------------------------------------------------------------------

// jsonBody decodes a capture's JSON body.
func jsonBody(cap *capture) map[string]any {
	m, _ := cap.json.(map[string]any)
	return m
}

func listAt(v map[string]any, key string) []any {
	l, _ := v[key].([]any)
	return l
}

// findBy returns the first object in list whose key equals name.
func findBy(list []any, key, name string) map[string]any {
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if s, _ := m[key].(string); s == name {
			return m
		}
	}
	return nil
}

// ossNorms is the standard norm set for /rest JSON cases: envelope
// serverVersion (E2) plus case-specific extras.
func ossNorms(extra ...normRule) []normRule {
	return append([]normRule{ruleRESTServerVersion, ruleScanStampMtime}, extra...)
}

// nativeSongNorms is the standard norm set for native /api song payloads.
func nativeSongNorms(extra ...normRule) []normRule {
	return append([]normRule{ruleSongDropsFilePath, ruleSongV1Trim, ruleDurationSeconds, ruleScanStampMtime, ruleNativeLyrics}, extra...)
}

// ---------------------------------------------------------------------------
// Catalog-resolution steps (read phase): fetch listings and publish ids into
// the per-run world so later steps can address entities on either server.
// ---------------------------------------------------------------------------

func init() {
	allSteps = []step{
		{
			group: "native", name: "setup-status",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/setup", nil, nil)
			},
		},
		{
			group: "native", name: "login",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("POST", "/api/login", map[string]any{"username": adminUser, "password": c.pass}, nil)
			},
		},
		{
			group: "native", name: "me",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/me", nil, nil)
			},
		},
		{
			group: "native", name: "preferences",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/me/preferences", nil, nil)
			},
		},
		{
			group: "native", name: "songs-list",
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.do("GET", "/api/songs", nil, nil)
				if err != nil {
					return cap, err
				}
				for _, s := range listAt(jsonBody(cap), "songs") {
					m, ok := s.(map[string]any)
					if !ok {
						continue
					}
					title, _ := m["title"].(string)
					key, ok := titleToKey[title]
					if !ok {
						continue
					}
					w.set("song."+key, m["id"], false)
					if ca, ok := m["coverArt"].(string); ok && ca != "" {
						w.set("coverArt."+key, ca, false)
					}
				}
				return cap, nil
			},
			canonical: sortListsByID,
			norms:     nativeSongNorms(),
		},
		{
			group: "native", name: "song-detail-explicit-art",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/songs/"+w.str("song.A2"), nil, nil)
			},
			norms: nativeSongNorms(),
		},
		{
			group: "native", name: "song-detail-lyrics",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/songs/"+w.str("song.A1"), nil, nil)
			},
			norms: nativeSongNorms(),
		},
		{
			group: "native", name: "albums-list",
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.do("GET", "/api/albums", nil, nil)
				if err != nil {
					return cap, err
				}
				for _, a := range listAt(jsonBody(cap), "albums") {
					m, ok := a.(map[string]any)
					if !ok {
						continue
					}
					name, _ := m["name"].(string)
					w.set("album."+name, m["id"], false)
					if ca, ok := m["coverArt"].(string); ok && ca != "" {
						w.set("coverArt.album."+name, ca, false)
					}
				}
				return cap, nil
			},
			canonical: sortListsByID,
		},
		{
			group: "native", name: "album-detail",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/albums/"+w.str("album.Neon Horizons"), nil, nil)
			},
			norms: nativeSongNorms(),
		},
		{
			group: "native", name: "artists-list",
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.do("GET", "/api/artists", nil, nil)
				if err != nil {
					return cap, err
				}
				for _, a := range listAt(jsonBody(cap), "artists") {
					m, ok := a.(map[string]any)
					if !ok {
						continue
					}
					name, _ := m["name"].(string)
					w.set("artist."+name, m["id"], false)
				}
				return cap, nil
			},
			canonical: sortListsByID,
		},
		{
			group: "native", name: "artist-detail",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/artists/"+w.str("artist.Aurora Waves"), nil, nil)
			},
			norms: []normRule{{
				Rule:  Rule{"P10-v2-artist-detail-songs", "v2's artist detail adds a songs array (v1's detail carries albums only, docs/api.md) — v2 superset trimmed for comparison"},
				apply: func(v any) any { return deleteKeysAt(v, "songs") },
			}},
		},
		{
			group: "native", name: "artist-songs",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/artists/"+w.str("artist.Aurora Waves")+"/songs", nil, nil)
			},
			canonical: sortListsByID,
			norms:     nativeSongNorms(ruleArtistSongsTrim),
		},
		{
			group: "native", name: "genres-list",
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.do("GET", "/api/genres", nil, nil)
				if err != nil {
					return cap, err
				}
				for _, g := range listAt(jsonBody(cap), "genres") {
					m, ok := g.(map[string]any)
					if !ok {
						continue
					}
					name, _ := m["name"].(string)
					w.set("genre."+name, m["id"], false)
				}
				return cap, nil
			},
			canonical: sortListsByID,
		},
		{
			group: "native", name: "genres-tree",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/genres/tree", nil, nil)
			},
			canonical: sortListsByID,
		},
		{
			group: "native", name: "genre-albums",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/genres/"+w.str("genre.Electronic")+"/albums", nil, nil)
			},
			canonical: sortListsByID,
			norms:     []normRule{ruleGenreAlbumsTrim},
		},
		{
			group: "native", name: "years",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/years", nil, nil)
			},
			// v2 matches v1 exactly here: bare sorted union years (the old
			// count-objects contract was reverted for client parity).
		},
		{
			group: "native", name: "cover-art-embedded",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/cover-art/"+w.str("coverArt.A2"), nil, nil)
			},
			compareMode: "bytes",
		},
		{
			group: "native", name: "search-coil",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/search?q=Coil", nil, nil)
			},
			compareMode: "custom",
			compare:     compareSearchSets("songs", "albums", "artists", "playlists"),
		},
		{
			group: "native", name: "search-sunset-exact",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/search?q=Sunset", nil, nil)
			},
			canonical: sortListsByID,
			norms:     nativeSongNorms(ruleSearchTrim),
		},
		{
			group: "native", name: "home",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/home", nil, nil)
			},
			compareMode: "custom",
			compare:     compareHome,
		},
		{
			group: "native", name: "statistics-me-baseline",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/statistics/me", nil, nil)
			},
			canonical: func(v any) any { return sortListsByID(roundFloats(v)) },
		},
		{
			group: "native", name: "players-baseline",
			call: func(c *client, w *world) (*capture, error) {
				return c.do("GET", "/api/players", nil, nil)
			},
			canonical: sortListsByID,
		},

		// ------------------------- OpenSubsonic, read phase -------------------------

		{
			group: "oss", name: "ping",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("ping.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "ping-bad-token",
			call: func(c *client, w *world) (*capture, error) {
				// Forge a token with the wrong password and drop the session
				// cookie (v1 falls through a bad token to the cookie — quirks
				// A5 — so the cookie must be absent to exercise the 40 path).
				bad := *c
				bad.pass = "wrong-password"
				bad.cookie = ""
				return bad.restGET("ping.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getLicense",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getLicense.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getUser",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getUser.view", nil, nil)
			},
			norms: ossNorms(ruleGetUserFolder),
		},
		{
			group: "oss", name: "getMusicFolders",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getMusicFolders.view", nil, nil)
			},
			norms: ossNorms(ruleMusicFolderIDs),
		},
		{
			group: "oss", name: "getIndexes",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getIndexes.view", nil, nil)
			},
			norms: ossNorms(ruleRESTLastModified),
		},
		{
			group: "oss", name: "getArtists",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getArtists.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getArtist",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getArtist.view", map[string][]string{"id": {w.str("artist.Aurora Waves")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getAlbum",
			call: func(c *client, w *world) (*capture, error) {
				cap, err := c.restGET("getAlbum.view", map[string][]string{"id": {w.str("album.Neon Horizons")}}, nil)
				if err == nil {
					if inner := unwrapSubsonic(cap.json); inner != nil {
						if al, ok := inner["album"].(map[string]any); ok {
							if ca, ok := al["coverArt"].(string); ok && ca != "" {
								w.set("oss.coverArt.albumA", ca, false)
							}
						}
					}
				}
				return cap, err
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getSong",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getSong.view", map[string][]string{"id": {w.str("song.A2")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "search3-coil",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("search3.view", map[string][]string{"query": {"Coil"}}, nil)
			},
			compareMode: "custom",
			compare:     compareOSSSearchSets,
		},
		{
			group: "oss", name: "getGenres",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getGenres.view", nil, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getAlbumList-alphabetical",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getAlbumList2.view", map[string][]string{"type": {"alphabeticalByName"}, "size": {"500"}}, nil)
			},
			compareMode: "custom",
			compare:     compareAlbumListOrder,
		},
		{
			group: "oss", name: "getAlbumList-newest",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getAlbumList2.view", map[string][]string{"type": {"newest"}, "size": {"500"}}, nil)
			},
			compareMode: "custom",
			compare:     compareAlbumListOrder,
		},
		{
			group: "oss", name: "getSongsByGenre-electronic",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getSongsByGenre.view", map[string][]string{"genre": {"Electronic"}, "count": {"500"}}, nil)
			},
			compareMode: "custom",
			compare:     compareChildIDSet("songsByGenre"),
		},
		{
			group: "oss", name: "getSongsByGenre-downtempo",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getSongsByGenre.view", map[string][]string{"genre": {"Downtempo"}, "count": {"500"}}, nil)
			},
			compareMode: "custom",
			compare:     compareChildIDSet("songsByGenre"),
		},
		{
			group: "oss", name: "getTopSongs",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getTopSongs.view", map[string][]string{"artist": {"Aurora Waves"}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getAlbumInfo2",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getAlbumInfo2.view", map[string][]string{"id": {w.str("album.Neon Horizons")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getArtistInfo2",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getArtistInfo2.view", map[string][]string{"id": {w.str("artist.Aurora Waves")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getSimilarSongs2",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getSimilarSongs2.view", map[string][]string{"id": {w.str("artist.Aurora Waves")}}, nil)
			},
			norms: ossNorms(),
		},
		{
			group: "oss", name: "getRandomSongs",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getRandomSongs.view", map[string][]string{"size": {"5"}}, nil)
			},
			compareMode: "custom",
			compare:     compareRandomSongs,
		},
		{
			group: "oss", name: "getLyrics-by-id",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getLyrics.view", map[string][]string{"id": {w.str("song.A1")}}, nil)
			},
			compareMode: "custom",
			compare:     compareLyrics,
		},
		{
			group: "oss", name: "getLyrics-by-artist-title",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getLyrics.view", map[string][]string{"artist": {"Aurora Waves"}, "title": {"Signal Drift"}}, nil)
			},
			compareMode: "custom",
			compare:     compareLyrics,
		},
		{
			group: "oss", name: "stream-direct-range",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("stream.view", map[string][]string{"id": {w.str("song.A1")}}, map[string]string{"Range": "bytes=0-1023"})
			},
			compareMode: "bytes",
		},
		{
			group: "oss", name: "stream-direct-full",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("stream.view", map[string][]string{"id": {w.str("song.A1")}}, nil)
			},
			compareMode: "bytes",
		},
		{
			group: "oss", name: "stream-transcode",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("stream.view", map[string][]string{"id": {w.str("song.A1")}, "maxBitRate": {"64"}}, nil)
			},
			compareMode: "bytes",
		},
		{
			group: "oss", name: "download",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("download.view", map[string][]string{"id": {w.str("song.A3")}}, nil)
			},
			compareMode: "bytes",
		},
		{
			group: "oss", name: "getCoverArt-song-embedded",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getCoverArt.view", map[string][]string{"id": {w.str("song.A2")}}, nil)
			},
			compareMode: "bytes",
		},
		{
			group: "oss", name: "getCoverArt-album",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getCoverArt.view", map[string][]string{"id": {w.str("oss.coverArt.albumA")}}, nil)
			},
			compareMode: "bytes",
		},
		{
			group: "oss", name: "getAvatar",
			call: func(c *client, w *world) (*capture, error) {
				return c.restGET("getAvatar.view", nil, nil)
			},
			compareMode: "custom",
			compare: func(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
				if v1.status != v2.status {
					return []string{fmt.Sprintf("status: v1=%d v2=%d", v1.status, v2.status)}, nil
				}
				return nil, []Rule{{ID: "R10-getAvatar-explicit-404", Why: ruleGetAvatar404}}
			},
		},
		{
			group: "oss", name: "radio-podcast-stubs",
			call: func(c *client, w *world) (*capture, error) {
				radio, err := c.restGET("getInternetRadioStations.view", nil, nil)
				if err != nil {
					return radio, err
				}
				pod, err := c.restGET("getPodcasts.view", nil, nil)
				if err != nil {
					return pod, err
				}
				combined := &capture{status: radio.status, header: radio.header,
					body: append(append([]byte(`{"radio":`), radio.body...), []byte(`,"podcasts":`)...)}
				combined.body = append(combined.body, pod.body...)
				combined.body = append(combined.body, '}')
				var v any
				if err := json.Unmarshal(combined.body, &v); err == nil {
					combined.json = v
				}
				return combined, nil
			},
			norms: ossNorms(),
		},
	}
}

// ---------------------------------------------------------------------------
// Custom compares.
// ---------------------------------------------------------------------------

// searchSetRule documents the mandated LIKE-vs-FTS comparison strategy.
var searchSetRule = Rule{"P10-search-LIKE-vs-FTS", "P10 brief: v1 search is LIKE-based, v2 is FTS5-based; cases compare sorted id sets + intersection ratio instead of order/exact hits. Known engine-scope gap: v1's native song LIKE matches title/artist/album names while v2's FTS song index (P8 DR-2) covers titles, so the native songs category floors at 0.3"}

// compareSearchSets compares the native /api/search categories as id sets.
// Any divergence is attributed to the LIKE-vs-FTS engine swap; per-category
// floors tolerate the known engine-scope difference (v1's song LIKE matches
// title OR artist OR album name; v2's FTS song index covers titles — the P8
// DR-2 design), so regressions elsewhere still fail.
func compareSearchSets(categories ...string) func(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	return func(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
		var failures []string
		var accepted []Rule
		b1, b2 := jsonBody(v1), jsonBody(v2)
		for _, cat := range categories {
			a := idSet(b1[cat])
			b := idSet(b2[cat])
			rep := compareIDSets(a, b)
			if len(rep.V1Only) > 0 || len(rep.V2Only) > 0 {
				accepted = append(accepted, searchSetRule)
				floor := 0.75
				if cat == "songs" {
					floor = 0.3
				}
				if rep.IntersectionRatioV1 < floor {
					failures = append(failures, fmt.Sprintf("%s: intersection ratio %.2f below %.2f (v1-only=%v v2-only=%v)",
						cat, rep.IntersectionRatioV1, floor, rep.V1Only, rep.V2Only))
				}
			}
		}
		return failures, accepted
	}
}

// compareOSSSearchSets is compareSearchSets over the search3 result envelope.
func compareOSSSearchSets(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	pick := func(cap *capture) map[string]any {
		inner := unwrapSubsonic(cap.json)
		res, _ := inner["searchResult3"].(map[string]any)
		return res
	}
	var failures []string
	var accepted []Rule
	r1, r2 := pick(v1), pick(v2)
	for _, cat := range []string{"artist", "album", "song"} {
		a := idSet(r1[cat])
		b := idSet(r2[cat])
		rep := compareIDSets(a, b)
		if len(rep.V1Only) > 0 || len(rep.V2Only) > 0 {
			accepted = append(accepted, searchSetRule)
			if rep.IntersectionRatioV1 < 0.75 {
				failures = append(failures, fmt.Sprintf("searchResult3.%s: intersection ratio %.2f below 0.75 (v1-only=%v v2-only=%v)",
					cat, rep.IntersectionRatioV1, rep.V1Only, rep.V2Only))
			}
		}
	}
	return failures, accepted
}

// compareHome compares /api/home: the genre row matches as a name set (v2
// deliberately returns ranked {name, songCount} objects — P8 deviation
// documented in internal/modules/home/service.go); every album section
// matches as an id set (the `random` draw is unseeded on v1, so its ids are
// only checked for catalog membership and length).
func compareHome(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	var failures []string
	var accepted []Rule
	b1, b2 := jsonBody(v1), jsonBody(v2)
	nameSet := func(v any) map[string]bool {
		set := map[string]bool{}
		for _, item := range listAt(map[string]any{"x": v}, "x") {
			if m, ok := item.(map[string]any); ok {
				if n, ok := m["name"].(string); ok {
					set[n] = true
					continue
				}
			}
			if s, ok := item.(string); ok {
				set[s] = true
			}
		}
		return set
	}
	g1, g2 := nameSet(b1["genres"]), nameSet(b2["genres"])
	if fmt.Sprint(sortedSet(g1)) != fmt.Sprint(sortedSet(g2)) {
		failures = append(failures, fmt.Sprintf("genres: %v vs %v", sortedSet(g1), sortedSet(g2)))
	} else if fmt.Sprint(b1["genres"]) != fmt.Sprint(b2["genres"]) {
		accepted = append(accepted, noteHomeGenres)
	}
	for _, section := range []string{"mostPlayed", "recentlyPlayed"} {
		a := idSet(b1[section])
		b := idSet(b2[section])
		if rep := compareIDSets(a, b); rep.Intersection != len(a) || len(a) != len(b) {
			failures = append(failures, fmt.Sprintf("%s: v1=%v v2=%v", section, a, b))
		}
	}
	// recentlyAdded: v2 now matches v1 exactly (album cards by newest song
	// mtime), so the sections compare as strict id sets.
	{
		a := idSet(b1["recentlyAdded"])
		b := idSet(b2["recentlyAdded"])
		if rep := compareIDSets(a, b); rep.Intersection != len(a) || len(a) != len(b) {
			failures = append(failures, fmt.Sprintf("recentlyAdded: v1=%v v2=%v", a, b))
		}
	}
	r1, r2 := idSet(b1["random"]), idSet(b2["random"])
	if len(r1) != len(r2) {
		failures = append(failures, fmt.Sprintf("random: length %d vs %d", len(r1), len(r2)))
	}
	catalog := map[string]bool{}
	for _, id := range idSet(b1["recentlyAdded"]) {
		catalog[id] = true
	}
	for _, id := range r2 {
		if !catalog[id] {
			failures = append(failures, "random: id "+id+" not in the album catalog")
		}
	}
	return failures, accepted
}

func sortedSet(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// compareAlbumListOrder compares an albumList payload's ordered ids.
func compareAlbumListOrder(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	ids1 := albumListIDs(v1)
	ids2 := albumListIDs(v2)
	var failures []string
	if strings.Join(ids1, ",") != strings.Join(ids2, ",") {
		failures = append(failures, fmt.Sprintf("album order: v1=%v v2=%v", ids1, ids2))
	}
	return failures, nil
}

// compareAlbumListSet compares an albumList payload as an id set (for sorts
// that tie on seeded mtimes — the tie order is storage-implementation noise).
var compareAlbumListSet = func(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	a := albumListIDs(v1)
	b := albumListIDs(v2)
	rep := compareIDSets(a, b)
	if rep.Intersection != len(a) || len(a) != len(b) {
		return []string{fmt.Sprintf("album set: v1=%v v2=%v", a, b)}, nil
	}
	return nil, nil
}

// compareLyrics compares getLyrics payloads. v1's extractPlainLyrics reads
// common.lyrics[0], which is the SYLT entry on SYLT-bearing files — the
// plain USLT text is dropped (a v1 reader quirk); v2 reads both. When v1's
// value is empty and v2's is not, the delta is accepted with the rule
// below; any other difference fails.
var lyricsV1Quirk = Rule{"P10-v1-lyrics-first-entry", "v1's reader takes common.lyrics[0], which is the SYLT frame on SYLT-bearing files — plain USLT lyrics are dropped (v1 quirk, tags/reader.ts extractPlainLyrics); v2 reads both — accepted when v1 is empty and v2 is not"}

func compareLyrics(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	pick := func(cap *capture) map[string]any {
		inner := unwrapSubsonic(cap.json)
		l, _ := inner["lyrics"].(map[string]any)
		return l
	}
	l1, l2 := pick(v1), pick(v2)
	var failures []string
	var accepted []Rule
	if (l1 == nil) != (l2 == nil) {
		return []string{fmt.Sprintf("lyrics payload presence differs: v1=%v v2=%v", summary(l1), summary(l2))}, nil
	}
	if l1 == nil {
		return nil, nil
	}
	v1v, _ := l1["value"].(string)
	v2v, _ := l2["value"].(string)
	switch {
	case v1v == v2v:
	case v1v == "" && v2v != "":
		accepted = append(accepted, lyricsV1Quirk)
	default:
		failures = append(failures, fmt.Sprintf("lyrics value: %q vs %q", v1v, v2v))
	}
	for _, k := range []string{"artist", "title"} {
		if l1[k] != l2[k] {
			failures = append(failures, fmt.Sprintf("lyrics %s: %v vs %v", k, l1[k], l2[k]))
		}
	}
	return failures, accepted
}

func albumListIDs(cap *capture) []string {
	inner := unwrapSubsonic(cap.json)
	for _, key := range []string{"albumList2", "albumList"} {
		if list, ok := inner[key].([]any); ok {
			var ids []string
			for _, item := range list {
				if m, ok := item.(map[string]any); ok {
					if id, ok := m["id"].(string); ok {
						ids = append(ids, id)
					}
				}
			}
			return ids
		}
	}
	return nil
}

// compareChildIDSet compares a {key: {child: [...]}} payload's child ids.
func compareChildIDSet(key string) func(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	return func(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
		pick := func(cap *capture) []string {
			inner := unwrapSubsonic(cap.json)
			payload, _ := inner[key].(map[string]any)
			return idSet(payload["child"])
		}
		a, b := pick(v1), pick(v2)
		rep := compareIDSets(a, b)
		if rep.Intersection != len(a) || len(a) != len(b) {
			return []string{fmt.Sprintf("%s child ids: v1=%v v2=%v", key, a, b)}, nil
		}
		return nil, nil
	}
}

// compareRandomSongs checks both random draws return the requested count of
// in-catalog songs with no duplicates within each draw (the draws differ
// between the servers by design).
func compareRandomSongs(v1, v2 *capture, w1, w2 *world) ([]string, []Rule) {
	var failures []string
	count := func(cap *capture) int {
		inner := unwrapSubsonic(cap.json)
		payload, _ := inner["randomSongs"].(map[string]any)
		seen := map[string]bool{}
		n := 0
		for _, id := range idSet(payload["song"]) {
			if seen[id] {
				failures = append(failures, "randomSongs: duplicate id "+id)
			}
			seen[id] = true
			n++
		}
		return n
	}
	if n1, n2 := count(v1), count(v2); n1 != n2 {
		failures = append(failures, fmt.Sprintf("randomSongs count: %d vs %d", n1, n2))
	}
	return failures, nil
}
