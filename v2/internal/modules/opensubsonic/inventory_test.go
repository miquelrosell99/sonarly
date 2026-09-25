package opensubsonic

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// p9Routes is the phase inventory: v1's 17 browsing + 7 retrieval
// endpoints (P9a) plus the 15 starring/activity/playlist/bookmark
// endpoints of P9b.
var p9aRoutes = []struct {
	name   string
	method string
	path   string
}{
	// Browsing (v1 browsing.ts).
	{"getMusicFolders", http.MethodGet, "/rest/getMusicFolders.view"},
	{"getIndexes", http.MethodGet, "/rest/getIndexes.view"},
	{"getArtists", http.MethodGet, "/rest/getArtists.view"},
	{"getArtist", http.MethodGet, "/rest/getArtist.view"},
	{"getAlbum", http.MethodGet, "/rest/getAlbum.view"},
	{"getSong", http.MethodGet, "/rest/getSong.view"},
	{"getAlbumList", http.MethodGet, "/rest/getAlbumList.view"},
	{"getAlbumList2", http.MethodGet, "/rest/getAlbumList2.view"},
	{"getGenres", http.MethodGet, "/rest/getGenres.view"},
	{"search3", http.MethodGet, "/rest/search3.view"},
	{"getSongsByGenre", http.MethodGet, "/rest/getSongsByGenre.view"},
	{"getRandomSongs", http.MethodGet, "/rest/getRandomSongs.view"},
	{"getTopSongs", http.MethodGet, "/rest/getTopSongs.view"},
	{"getSimilarSongs2", http.MethodGet, "/rest/getSimilarSongs2.view"},
	{"getArtistInfo2", http.MethodGet, "/rest/getArtistInfo2.view"},
	{"getAlbumInfo", http.MethodGet, "/rest/getAlbumInfo.view"},
	{"getAlbumInfo2", http.MethodGet, "/rest/getAlbumInfo2.view"},
	// Retrieval (v1 retrieval.ts).
	{"stream", http.MethodGet, "/rest/stream.view"},
	{"download", http.MethodGet, "/rest/download.view"},
	{"getCoverArt", http.MethodGet, "/rest/getCoverArt.view"},
	{"getLyrics", http.MethodGet, "/rest/getLyrics.view"},
	{"getInternetRadioStations", http.MethodGet, "/rest/getInternetRadioStations.view"},
	{"getPodcasts", http.MethodGet, "/rest/getPodcasts.view"},
	{"getNewestPodcasts", http.MethodGet, "/rest/getNewestPodcasts.view"},
	// Starring + scrobble (v1 starring.ts, P9b).
	{"star", http.MethodGet, "/rest/star.view"},
	{"unstar", http.MethodGet, "/rest/unstar.view"},
	{"setRating", http.MethodGet, "/rest/setRating.view"},
	{"scrobble", http.MethodGet, "/rest/scrobble.view"},
	{"getStarred", http.MethodGet, "/rest/getStarred.view"},
	{"getStarred2", http.MethodGet, "/rest/getStarred2.view"},
	// Activity (v1 now-playing.ts, P9b).
	{"getNowPlaying", http.MethodGet, "/rest/getNowPlaying.view"},
	// Playlists (v1 playlists/opensubsonic-routes.ts, P9b).
	{"getPlaylists", http.MethodGet, "/rest/getPlaylists.view"},
	{"getPlaylist", http.MethodGet, "/rest/getPlaylist.view"},
	{"createPlaylist", http.MethodGet, "/rest/createPlaylist.view"},
	{"updatePlaylist", http.MethodGet, "/rest/updatePlaylist.view"},
	{"deletePlaylist", http.MethodGet, "/rest/deletePlaylist.view"},
	// Bookmarks (v1 bookmarks/routes.ts, P9b).
	{"getBookmarks", http.MethodGet, "/rest/getBookmarks.view"},
	{"createBookmark", http.MethodGet, "/rest/createBookmark.view"},
	{"deleteBookmark", http.MethodGet, "/rest/deleteBookmark.view"},
}

// TestEndpointInventory asserts every P9a route is registered on the chi
// router (walking the production route tree) and answers a real request —
// not the E5 "not implemented" envelope unknown routes get.
func TestEndpointInventory(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	registered := map[string]bool{}
	if err := chi.Walk(app.router.(chi.Router), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		registered[method+" "+route] = true
		return nil
	}); err != nil {
		t.Fatalf("walk routes: %v", err)
	}

	for _, e := range p9aRoutes {
		t.Run(e.name, func(t *testing.T) {
			if !registered[e.method+" "+e.path] {
				t.Fatalf("route %s %s not registered", e.method, e.path)
			}
			// Every endpoint answers through the auth hook; with valid
			// credentials it must not fall into the E5 unknown-route
			// envelope (code 0). Endpoints needing params answer 70/10 or
			// an OK envelope — all distinguishable from "not implemented".
			rec := app.get(t, authedURL(e.path, ""), nil)
			body := rec.Body.String()
			if strings.Contains(body, `"code":0`) && strings.Contains(body, "Not implemented") {
				t.Fatalf("%s answered the unknown-route envelope: %s", e.path, body)
			}
		})
	}
}

// TestStreamHeadInventory: the HEAD companions of stream/download are
// registered too (v1 answered HEAD via Fastify's automatic handling; R4).
func TestStreamHeadInventory(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")

	for _, path := range []string{"/rest/stream.view", "/rest/download.view"} {
		rec := app.head(t, authedURL(path, "&id="+c.SAbbey1), nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("HEAD %s = %d", path, rec.Code)
		}
	}
}

// TestGetAvatarRegistered: the avatar stub is an explicit route (answering
// 404) rather than the unknown-route envelope.
func TestGetAvatarRegistered(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getAvatar.view", ""), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("getAvatar = %d", rec.Code)
	}
}

// TestRouteTableMatchesInventory keeps the registration table
// (routes.go endpointRoutes) and this phase's inventory in lockstep: every
// P9a path is registered exactly once per method by the table itself.
func TestRouteTableMatchesInventory(t *testing.T) {
	table := map[string]int{}
	for _, e := range endpointRoutes {
		table[e.method+" /rest"+e.path]++
	}
	for _, e := range p9aRoutes {
		if table[e.method+" "+e.path] != 1 {
			t.Fatalf("endpointRoutes must register %s %s exactly once, got %d",
				e.method, e.path, table[e.method+" "+e.path])
		}
	}
	// The only multi-row paths are the HEAD companions of the two binary
	// endpoints (stream/download); getAvatar is a v2 stub beyond v1's set.
	if len(endpointRoutes) != len(p9aRoutes)+4+2+1 {
		t.Fatalf("endpointRoutes drifted: %d rows (want %d adapter endpoints + 4 system + 2 HEAD + 1 getAvatar)",
			len(endpointRoutes), len(p9aRoutes))
	}
	fmt.Printf("adapter route table: %d endpoints registered\n", len(endpointRoutes))
}
