// Client-contract field gate.
//
// The route-coverage test (cmd/sonarly/spec_test.go) pins the spec's PATHS to
// the chi router, but nothing pins the spec's response SCHEMAS to what the web
// client actually dereferences. The incident this gate exists for: the
// PlaylistDetail DTO dropped `rules`, the smart-playlist editor silently fell
// back to a default rule, and route coverage stayed green the whole time.
//
// This test loads server/api/openapi.yaml, resolves local $refs, and asserts
// that every field the web client consumes is declared in that endpoint's
// success application/json response schema. The inventory below is curated
// from grep evidence in web/src — each group cites its consuming file(s).
// When a client starts reading a new response field, add it here; when the
// contract legitimately changes, update both together.
package contractcheck_test

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

const specPath = "../../api/openapi.yaml"

// fieldRef is one client-consumed response field, as a dot path relative to
// the response body. Array segments are traversed transparently
// ("years.year" means body.years[].year).
type fieldRef struct {
	path string
	// Client file:line evidence, surfaced in failure messages.
	usedAt string
}

// endpointRef is one endpoint whose success response the client reads.
type endpointRef struct {
	method string
	path   string
	status string // success response key ("200", or "201" for creates)
	fields []fieldRef
}

// inventory is the curated endpoint -> required-response-fields table, built
// from the web client's actual consumption (web/src), not from every spec
// field. Keep it lean: fields the client dereferences, with grep evidence.
var inventory = []endpointRef{
	// --- GET /api/playlists/{id} ------------------------------------------
	// Consumers: web/src/hooks/usePlaylist.ts:30-34 (selects data.playlist);
	// web/src/features/playlists/components/CreatePlaylistModal.tsx:43-47
	// (name/isSmart/resolveMode/rules — `playlist.rules ?? DEFAULT_RULES` is the
	// incident this gate exists for);
	// web/src/features/playlists/pages/PlaylistDetail.tsx:87-93,196-198,239-244,254-258
	// (entries/songCount/starred/visibility, isOwner via ownerId);
	// web/src/features/playlists/components/SharePlaylistModal.tsx:244-246,328
	// (shares/shareToken);
	// web/src/features/now-playing/pages/NowPlayingRoute.tsx:99-104 (entries
	// artist/album for the queue).
	{
		method: "get",
		path:   "/api/playlists/{id}",
		status: "200",
		fields: []fieldRef{
			{"playlist.id", "PlaylistDetail.tsx:212/270 (cover/menu key)"},
			{"playlist.name", "PlaylistDetail.tsx:206,208,243; CreatePlaylistModal.tsx:43"},
			{"playlist.ownerId", "PlaylistDetail.tsx:87 (isOwner)"},
			{"playlist.visibility", "PlaylistDetail.tsx:255; SharePlaylistModal.tsx:222,234"},
			{"playlist.isSmart", "CreatePlaylistModal.tsx:45; PlaylistDetail.tsx:257"},
			{"playlist.resolveMode", "CreatePlaylistModal.tsx:46"},
			{"playlist.rules", "CreatePlaylistModal.tsx:47 — the incident field (rules ?? DEFAULT_RULES)"},
			{"playlist.songCount", "PlaylistDetail.tsx:197 (metadata line)"},
			{"playlist.entries", "PlaylistDetail.tsx:89 (displayEntries); NowPlayingRoute.tsx:100"},
			{"playlist.starred", "PlaylistDetail.tsx:239-240 (FavoriteRatingGroup)"},
			{"playlist.shareToken", "SharePlaylistModal.tsx:245-246,353 (share URL, hadLink)"},
			{"playlist.shares", "SharePlaylistModal.tsx:244 (members tab)"},
			{"playlist.entries.id", "PlaylistDetail.tsx:98 (startIndex find)"},
			{"playlist.entries.title", "hooks/usePlaylist.ts PlaylistDetailEntry (SongTable rows)"},
			{"playlist.entries.album", "NowPlayingRoute.tsx:103 (albumName)"},
			{"playlist.entries.artist", "PlaylistDetail.tsx:91; NowPlayingRoute.tsx:102 (artistName)"},
		},
	},

	// --- GET /api/playlists (list) ----------------------------------------
	// Consumers: web/src/hooks/usePlaylists.ts:6-9 (selects data.playlists);
	// web/src/features/playlists/pages/Playlists.tsx:65-117 (name/songCount/
	// starred); web/src/components/Sidebar.tsx:191-199 (id/name/ownerId).
	{
		method: "get",
		path:   "/api/playlists",
		status: "200",
		fields: []fieldRef{
			{"playlists.id", "Playlists.tsx:111 (getId); Sidebar.tsx:191,195"},
			{"playlists.name", "Playlists.tsx:66,92; Sidebar.tsx (label)"},
			{"playlists.ownerId", "Sidebar.tsx:199 (isOwner = ownerId === user.id)"},
			{"playlists.songCount", "Playlists.tsx:84,93"},
			{"playlists.starred", "Playlists.tsx:115 (getFavorite)"},
		},
	},

	// --- POST /api/playlists (create) --------------------------------------
	// Consumer: web/src/features/playlists/components/CreatePlaylistModal.tsx:96-99.
	// The mutation fire-and-forgets the body (onSuccess invalidates the
	// ['playlists'] / ['playlist', id] keys), so only the response envelope and
	// created identity are pinned here.
	{
		method: "post",
		path:   "/api/playlists",
		status: "201",
		fields: []fieldRef{
			{"playlist", "CreatePlaylistModal.tsx:96-99 (documented {playlist} envelope)"},
			{"playlist.id", "CreatePlaylistModal.tsx:103-104 (invalidate ['playlist', id])"},
		},
	},

	// --- PUT /api/playlists/{id} (update) ----------------------------------
	// Consumer: web/src/features/playlists/components/CreatePlaylistModal.tsx:90-93
	// (fire-and-forget; response body unread — envelope pinned only).
	{
		method: "put",
		path:   "/api/playlists/{id}",
		status: "200",
		fields: []fieldRef{
			{"playlist", "CreatePlaylistModal.tsx:90-93 (documented {playlist} envelope)"},
		},
	},

	// --- GET /api/home ------------------------------------------------------
	// Consumer: web/src/features/home/pages/HomePage.tsx — HomeData interface
	// (lines 36-42) reads exactly these five section keys; AlbumCard (184-235)
	// reads the album-card fields (starred/rating via the favorite/rate props);
	// RecentSongCard (363-415) reads the song-card fields; mostPlayed/random/
	// recentlyPlayed all flow through those same two card components, so the
	// full field set is asserted once on mostPlayed and the other two sections
	// assert their key.
	{
		method: "get",
		path:   "/api/home",
		status: "200",
		fields: []fieldRef{
			{"genres.name", "HomePage.tsx:27 (HomeGenre), 37"},
			{"genres.songCount", "HomePage.tsx:28, 37"},
			{"mostPlayed.id", "HomePage.tsx:673, 703 (section key + card key)"},
			{"mostPlayed.name", "HomePage.tsx:189, 485 (AlbumCard/FeaturedAlbumSlide)"},
			{"mostPlayed.artistId", "HomePage.tsx:194"},
			{"mostPlayed.artistName", "HomePage.tsx:196, 494"},
			{"mostPlayed.year", "HomePage.tsx:201, 499"},
			{"mostPlayed.coverArt", "HomePage.tsx:215, 476"},
			{"mostPlayed.starred", "HomePage.tsx:221-222 (favorite toggle)"},
			{"mostPlayed.rating", "HomePage.tsx:226-227"},
			{"random", "HomePage.tsx:38, 675, 714 (section — entries read via the album card fields)"},
			{"recentAdditions", "HomePage.tsx:40, 723-728 (section key)"},
			{"recentAdditions.id", "HomePage.tsx:367, 727 (RecentSongCard)"},
			{"recentAdditions.title", "HomePage.tsx:370, 396"},
			{"recentAdditions.artistName", "HomePage.tsx:377"},
			{"recentAdditions.albumName", "HomePage.tsx:386"},
			{"recentAdditions.explicit", "HomePage.tsx:369 (ExplicitTitle)"},
			{"recentAdditions.coverArt", "HomePage.tsx:395"},
			{"recentlyPlayed", "HomePage.tsx:41, 674, 738 (section key)"},
		},
	},

	// --- GET /api/years -----------------------------------------------------
	// Consumers: web/src/features/years/pages/Years.tsx:36-52 (year + songCount
	// columns/cards); web/src/hooks/useLibraryLists.ts:132-139 (YearCount type).
	{
		method: "get",
		path:   "/api/years",
		status: "200",
		fields: []fieldRef{
			{"years.year", "Years.tsx:41, 51 (column + card)"},
			{"years.songCount", "Years.tsx:42, 51"},
		},
	},

	// --- GET /api/songs -----------------------------------------------------
	// Consumers: web/src/features/tracks/pages/Tracks.tsx:31-53 (table columns
	// + client-side filters incl. favorites); web/src/features/genres/pages/
	// Genres.tsx:32,47 (t.genres); web/src/features/years/pages/Years.tsx:22,30
	// (t.year); web/src/features/artists/pages/Artist.tsx:62 (s.artistId);
	// web/src/features/now-playing/pages/NowPlayingRoute.tsx:110-111 (queue build).
	{
		method: "get",
		path:   "/api/songs",
		status: "200",
		fields: []fieldRef{
			{"songs.id", "Tracks.tsx:92 (row key/link)"},
			{"songs.title", "Tracks.tsx:93, 117"},
			{"songs.artistId", "Tracks.tsx artist link; Artist.tsx:62 filter"},
			{"songs.artistName", "Tracks.tsx:98"},
			{"songs.albumId", "Tracks.tsx album link (cards)"},
			{"songs.albumName", "Tracks.tsx:99"},
			{"songs.genres", "Genres.tsx:32,47 (genre matching)"},
			{"songs.year", "Years.tsx:22,30 (year matching)"},
			{"songs.explicit", "Tracks.tsx:91 (ExplicitTitle blur)"},
			{"songs.duration", "Tracks.tsx:106 (duration column)"},
			{"songs.starred", "Tracks.tsx:47 (favorites filter), 71"},
		},
	},

	// --- GET /api/songs/{id} ------------------------------------------------
	// Consumer: web/src/features/tracks/pages/Track.tsx:106-133,147-149,171-174
	// (header metadata links, cover, favorite toggle, lyrics editor props).
	{
		method: "get",
		path:   "/api/songs/{id}",
		status: "200",
		fields: []fieldRef{
			{"song.id", "Track.tsx:55,80,96,133,171"},
			{"song.title", "Track.tsx:133,172"},
			{"song.artistName", "Track.tsx:106,117,173"},
			{"song.artistId", "Track.tsx:106 (href)"},
			{"song.albumName", "Track.tsx:107,118"},
			{"song.albumId", "Track.tsx:107 (href)"},
			{"song.year", "Track.tsx:108-109"},
			{"song.duration", "Track.tsx:110,174"},
			{"song.albumCoverArt", "Track.tsx:133 (cover, ?? coverArt fallback)"},
			{"song.starred", "Track.tsx:147-148"},
		},
	},

	// --- GET /api/albums/{id} ------------------------------------------------
	// Consumers: web/src/features/albums/pages/Album.tsx:27-46 (Album
	// interface), 106-129 (play queue from detail.songs, favorite toggle);
	// web/src/features/home/pages/HomePage.tsx:67-85 (AlbumDetail fetch to play
	// an album card); web/src/features/search/pages/SearchResults.tsx:142.
	{
		method: "get",
		path:   "/api/albums/{id}",
		status: "200",
		fields: []fieldRef{
			{"album.id", "Album.tsx:129 (favorite), 229 (delete)"},
			{"album.name", "Album.tsx (EntityDetail title)"},
			{"album.artistId", "Album.tsx (artist link)"},
			{"album.artistName", "Album.tsx:27-46 interface"},
			{"album.year", "Album.tsx interface (header metadata)"},
			{"album.genre", "Album.tsx interface (header metadata)"},
			{"album.coverArt", "Album.tsx (header cover)"},
			{"album.totalSongCount", "Album.tsx:36 (metadata line)"},
			{"album.starred", "Album.tsx:126-130"},
			{"album.rating", "Album.tsx (FavoriteRatingGroup)"},
			{"songs.id", "Album.tsx:108 (startIndex find)"},
		},
	},

	// --- GET /api/artists/{id} ----------------------------------------------
	// Consumer: web/src/features/artists/pages/Artist.tsx:21-38 (ArtistDetail
	// interface), 57-62 (artist + songs fetch, top-tracks filter on
	// songs.artistId), 88-115 (album card favorite/rate), artist image + header.
	{
		method: "get",
		path:   "/api/artists/{id}",
		status: "200",
		fields: []fieldRef{
			{"artist.id", "Artist.tsx:71,81 (favorite/rate target)"},
			{"artist.name", "Artist.tsx (EntityDetail title)"},
			{"artist.artistImageUrl", "Artist.tsx:34 (ArtistDetail interface)"},
			{"artist.rating", "Artist.tsx:78-82 (FavoriteRatingGroup)"},
			{"artist.albums.id", "Artist.tsx:96 (album card key/favorite)"},
			{"artist.albums.name", "Artist.tsx:21-29 (album card title)"},
			{"artist.albums.coverArt", "Artist.tsx:26 (card cover)"},
			{"songs.artistId", "Artist.tsx:62 (top-tracks filter)"},
		},
	},

	// --- GET /api/genres ----------------------------------------------------
	// Consumers: web/src/hooks/useLibraryLists.ts:117-121 (GenreListItem
	// id/name/path); web/src/features/genres/pages/Genres.tsx:44 (sorted list).
	{
		method: "get",
		path:   "/api/genres",
		status: "200",
		fields: []fieldRef{
			{"genres.id", "Genres.tsx (row key)"},
			{"genres.name", "Genres.tsx:50,57 (label + play matching)"},
			{"genres.path", "useLibraryLists.ts:120 (GenreListItem)"},
		},
	},

	// --- GET /api/genres/tree ------------------------------------------------
	// Consumer: web/src/features/admin/pages/AdminGenres.tsx:22-28 (GenreNode
	// interface), 73-76 (fetch), 90-106 (walk by id/children).
	{
		method: "get",
		path:   "/api/genres/tree",
		status: "200",
		fields: []fieldRef{
			{"tree.id", "AdminGenres.tsx:93,197,257 (node key, rename, move)"},
			{"tree.name", "AdminGenres.tsx:198,257 (label/edit)"},
			{"tree.children", "AdminGenres.tsx:28,43,94,105 (recursive walk)"},
		},
	},

	// --- GET /api/statistics/me ----------------------------------------------
	// Consumers: web/src/features/statistics/hooks/useStatistics.ts:19-24
	// (UserStatistics fetch); web/src/features/statistics/components/
	// StatisticsView.tsx:204-233 (totals HeroStats), 300-316 (top songs),
	// 353-391 (top artists/albums), 408-419 (top genres), 442-459 (top years),
	// 488-501 (rating donut), 620-692 (rated lists); MonthlyActivityChart.tsx:63-64
	// (monthlyPlays month/plays).
	{
		method: "get",
		path:   "/api/statistics/me",
		status: "200",
		fields: []fieldRef{
			{"totals.totalPlays", "StatisticsView.tsx:227,230"},
			{"totals.totalDurationListened", "StatisticsView.tsx:204"},
			{"totals.favoriteSongs", "StatisticsView.tsx:231"},
			{"monthlyPlays.month", "MonthlyActivityChart.tsx:63,117"},
			{"monthlyPlays.plays", "MonthlyActivityChart.tsx:64,144"},
			{"charts.ratingDistribution.ratings.rating", "StatisticsView.tsx:496-500"},
			{"charts.ratingDistribution.ratings.count", "StatisticsView.tsx:490,497"},
			{"top.topSongs.songId", "StatisticsView.tsx:302-303 (href)"},
			{"top.topSongs.title", "StatisticsView.tsx:306"},
			{"top.topSongs.plays", "StatisticsView.tsx:305,316"},
			{"top.topArtists.artistName", "StatisticsView.tsx:357-358"},
			{"top.topArtists.plays", "StatisticsView.tsx:356,359"},
			{"top.topAlbums.albumName", "StatisticsView.tsx:381-382"},
			{"top.topAlbums.plays", "StatisticsView.tsx:380,391"},
			{"top.topGenres.genre", "StatisticsView.tsx:408-410"},
			{"top.topGenres.plays", "StatisticsView.tsx:412,419"},
			{"top.topYears.year", "StatisticsView.tsx:442-446"},
			{"top.topYears.plays", "StatisticsView.tsx:452,459"},
			{"rated.topRatedArtists.artistName", "StatisticsView.tsx:620-626"},
			{"rated.topRatedArtists.averageRating", "StatisticsView.tsx:627"},
			{"rated.topRatedGenres.genre", "StatisticsView.tsx:650-654"},
			{"rated.topRatedYears.year", "StatisticsView.tsx:681-685"},
		},
	},

	// --- GET /api/players ----------------------------------------------------
	// Consumers: web/src/components/TopBar.tsx:39-57 (players poll + select),
	// 80-113 (other-players menu); web/src/types/player.ts:1-12 (PlayerInfo).
	{
		method: "get",
		path:   "/api/players",
		status: "200",
		fields: []fieldRef{
			{"players.id", "TopBar.tsx:111 (menu key)"},
			{"players.userId", "TopBar.tsx:43,80 (poll interval + other filter)"},
			{"players.clientId", "TopBar.tsx:112 (device label)"},
			{"players.songTitle", "TopBar.tsx:113 (now-playing line)"},
		},
	},

	// --- GET /api/bookmarks --------------------------------------------------
	// No live web/src dereference found (grep): only web/src/contract/wrapper.test.ts:101
	// exercises the DELETE bookmark route. The envelope key is pinned so a
	// renamed/removed bookmarks list cannot slip past the route-only gate.
	{
		method: "get",
		path:   "/api/bookmarks",
		status: "200",
		fields: []fieldRef{
			{"bookmarks", "no live consumer — envelope pinned (see group comment)"},
		},
	},

	// --- POST /api/favorites, POST /api/ratings ------------------------------
	// Consumer: web/src/hooks/useFavoriteActions.ts:18-30 — both helpers await
	// the 2xx and never read the body, so the {ok: true} shape is pinned as
	// the documented success contract rather than a dereferenced field.
	{
		method: "post",
		path:   "/api/favorites",
		status: "200",
		fields: []fieldRef{
			{"ok", "useFavoriteActions.ts:19-23 (documented Ok envelope)"},
		},
	},
	{
		method: "post",
		path:   "/api/ratings",
		status: "200",
		fields: []fieldRef{
			{"ok", "useFavoriteActions.ts:26-30 (documented Ok envelope)"},
		},
	},
}

// loadSpec parses the OpenAPI document relative to the module root.
func loadSpec(t *testing.T) (paths, schemas map[string]any) {
	t.Helper()
	raw, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("read spec: %v", err)
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse spec: %v", err)
	}
	paths, ok := doc["paths"].(map[string]any)
	if !ok {
		t.Fatalf("spec has no paths map")
	}
	components, ok := doc["components"].(map[string]any)
	if !ok {
		t.Fatalf("spec has no components map")
	}
	schemas, ok = components["schemas"].(map[string]any)
	if !ok {
		t.Fatalf("spec has no components.schemas map")
	}
	return paths, schemas
}

// deref follows a local "#/components/schemas/Name" $ref chain. External refs
// do not exist in this spec; unknown or cyclic refs simply stop expanding.
func deref(node any, schemas map[string]any, depth int) any {
	for depth > 0 {
		m, ok := node.(map[string]any)
		if !ok {
			return node
		}
		ref, ok := m["$ref"].(string)
		if !ok {
			return node
		}
		name, ok := strings.CutPrefix(ref, "#/components/schemas/")
		if !ok {
			return node
		}
		node = schemas[name]
		depth--
	}
	return node
}

// hasField walks the schema along fields, traversing arrays into their
// items. A field satisfies a oneOf/anyOf wrapper only when every
// object-typed branch declares it; allOf is satisfied by any branch.
func hasField(node any, fields []string, schemas map[string]any) bool {
	node = deref(node, schemas, 32)
	if len(fields) == 0 {
		return true
	}
	m, ok := node.(map[string]any)
	if !ok {
		return false
	}
	if typ, _ := m["type"].(string); typ == "array" {
		return hasField(m["items"], fields, schemas)
	}
	seg := fields[0]
	if props, ok := m["properties"].(map[string]any); ok {
		if child, ok := props[seg]; ok {
			return hasField(child, fields[1:], schemas)
		}
	}
	if allOf, ok := m["allOf"].([]any); ok {
		for _, branch := range allOf {
			if hasField(branch, fields, schemas) {
				return true
			}
		}
	}
	for _, key := range []string{"oneOf", "anyOf"} {
		branches, ok := m[key].([]any)
		if !ok {
			continue
		}
		sawObject := false
		allHave := true
		for _, branch := range branches {
			bm, ok := deref(branch, schemas, 32).(map[string]any)
			if !ok {
				continue
			}
			typ, _ := bm["type"].(string)
			if typ == "object" || bm["properties"] != nil {
				sawObject = true
				if !hasField(branch, fields, schemas) {
					allHave = false
				}
			}
		}
		if sawObject && allHave {
			return true
		}
	}
	return false
}

// responseSchema extracts the documented application/json schema of one
// endpoint's success response.
func responseSchema(paths map[string]any, ep endpointRef) (any, bool) {
	pm, ok := paths[ep.path].(map[string]any)
	if !ok {
		return nil, false
	}
	op, ok := pm[ep.method].(map[string]any)
	if !ok {
		return nil, false
	}
	responses, ok := op["responses"].(map[string]any)
	if !ok {
		return nil, false
	}
	resp, ok := responses[ep.status].(map[string]any)
	if !ok {
		return nil, false
	}
	content, ok := resp["content"].(map[string]any)
	if !ok {
		return nil, false
	}
	jsonContent, ok := content["application/json"].(map[string]any)
	if !ok {
		return nil, false
	}
	schema, ok := jsonContent["schema"]
	return schema, ok
}

// TestClientResponseFields is the gate: every client-consumed response field
// must be declared in the endpoint's success application/json schema.
func TestClientResponseFields(t *testing.T) {
	paths, schemas := loadSpec(t)

	checked := 0
	var failures []string
	for _, ep := range inventory {
		schema, ok := responseSchema(paths, ep)
		if !ok {
			failures = append(failures, fmt.Sprintf("%s %s: no %s application/json response documented at all",
				strings.ToUpper(ep.method), ep.path, ep.status))
			continue
		}
		for _, f := range ep.fields {
			checked++
			if !hasField(schema, strings.Split(f.path, "."), schemas) {
				failures = append(failures, fmt.Sprintf("%s %s %s: response schema does not declare field %q (client consumes it at %s)",
					strings.ToUpper(ep.method), ep.path, ep.status, f.path, f.usedAt))
			}
		}
	}

	t.Logf("checked %d client-consumed response fields across %d endpoints against %s", checked, len(inventory), specPath)
	for _, failure := range failures {
		t.Errorf("client-contract drift: %s", failure)
	}
}

// TestInventoryNotGutted guards the gate itself: the inventory must keep
// covering the client's real surface so a careless edit cannot shrink it
// into a rubber stamp.
func TestInventoryNotGutted(t *testing.T) {
	total := 0
	for _, ep := range inventory {
		total += len(ep.fields)
	}
	if total < 60 {
		t.Fatalf("inventory has only %d field assertions — the gate is too small to mean anything (floor: 60)", total)
	}
}
