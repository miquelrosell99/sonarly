package opensubsonic

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/playback"
	"github.com/miquelrosell99/sonarly/server/internal/modules/players"
	"github.com/miquelrosell99/sonarly/server/internal/modules/playlists"
)

// Handler wires the OpenSubsonic adapter to HTTP: the /rest group carries
// the session middleware (cookie + header-apiKey identity) first, then the
// Subsonic auth hook, then the endpoint groups (P6.5 system, P9a
// browsing/retrieval, P9b starring/now-playing/playlists/bookmarks).
type Handler struct {
	db          *sql.DB
	mw          *auth.Middleware
	auth        *Auth
	playback    *playback.Service
	tracker     *players.Tracker // P8 now-playing registry (N1)
	playlists   *playlists.Service
	libraryPath string // config library root: getMusicFolders basename fallback (B1)
}

// NewHandler builds the adapter. playback is the P5 StreamingService
// stream/download/scrobble/bookmark delegate; tracker is the P8 players
// registry feeding getNowPlaying; playlists is the P6 module service the
// playlist endpoints delegate to (ONE policy). playback/tracker/playlists
// may be nil in tests that never hit those endpoints.
func NewHandler(db *sql.DB, mw *auth.Middleware, sessionSecret, libraryPath string, playback *playback.Service, tracker *players.Tracker, playlistsSvc *playlists.Service) *Handler {
	return &Handler{
		db:          db,
		mw:          mw,
		auth:        NewAuth(db, sessionSecret),
		playback:    playback,
		tracker:     tracker,
		playlists:   playlistsSvc,
		libraryPath: libraryPath,
	}
}

// Routes registers the /rest group. Unknown /rest/* paths answer an
// enveloped error 0 "not implemented" instead of the old bare Fastify 404, so
// Subsonic clients get a parseable envelope during development (E5).
//
// The P9a inventory (retired browsing.ts 17 + retrieval.ts 7 endpoints) is
// registered here; endpointRoutes is the table the inventory test walks so
// P9b can extend it without re-listing handlers.
func (h *Handler) Routes(r chi.Router) {
	r.Route("/rest", func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, h.auth.Hook)
		for _, e := range endpointRoutes {
			e := e
			r.Method(e.method, e.path, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				e.handler(h, w, r)
			}))
		}
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			Error(w, r, CodeNotImplemented, "Not implemented")
		})
	})
}

// endpointRoute pairs one adapter route with the handler method serving it.
type endpointRoute struct {
	name    string
	method  string
	path    string
	handler func(*Handler, http.ResponseWriter, *http.Request)
}

// endpointRoutes is the full adapter endpoint table (P6.5 system + P9a
// browsing/retrieval + P9b starring/now-playing/playlists/bookmarks).
var endpointRoutes = []endpointRoute{
	// System group (P6.5).
	{"ping", http.MethodGet, "/ping.view", (*Handler).ping},
	{"getLicense", http.MethodGet, "/getLicense.view", (*Handler).getLicense},
	{"getOpenSubsonicExtensions", http.MethodGet, "/getOpenSubsonicExtensions.view", (*Handler).getOpenSubsonicExtensions},
	{"getUser", http.MethodGet, "/getUser.view", (*Handler).getUser},

	// Browsing group (P9a, the retired server browsing.ts).
	{"getMusicFolders", http.MethodGet, "/getMusicFolders.view", (*Handler).getMusicFolders},
	{"getIndexes", http.MethodGet, "/getIndexes.view", (*Handler).getIndexes},
	{"getArtists", http.MethodGet, "/getArtists.view", (*Handler).getArtists},
	{"getArtist", http.MethodGet, "/getArtist.view", (*Handler).getArtist},
	{"getAlbum", http.MethodGet, "/getAlbum.view", (*Handler).getAlbum},
	{"getSong", http.MethodGet, "/getSong.view", (*Handler).getSong},
	{"getAlbumList", http.MethodGet, "/getAlbumList.view", (*Handler).getAlbumList},
	{"getAlbumList2", http.MethodGet, "/getAlbumList2.view", (*Handler).getAlbumList2},
	{"getGenres", http.MethodGet, "/getGenres.view", (*Handler).getGenres},
	{"search3", http.MethodGet, "/search3.view", (*Handler).search3},
	{"getSongsByGenre", http.MethodGet, "/getSongsByGenre.view", (*Handler).getSongsByGenre},
	{"getRandomSongs", http.MethodGet, "/getRandomSongs.view", (*Handler).getRandomSongs},
	{"getTopSongs", http.MethodGet, "/getTopSongs.view", (*Handler).getTopSongs},
	{"getSimilarSongs2", http.MethodGet, "/getSimilarSongs2.view", (*Handler).getSimilarSongs2},
	{"getArtistInfo2", http.MethodGet, "/getArtistInfo2.view", (*Handler).getArtistInfo2},
	{"getAlbumInfo", http.MethodGet, "/getAlbumInfo.view", (*Handler).getAlbumInfo},
	{"getAlbumInfo2", http.MethodGet, "/getAlbumInfo2.view", (*Handler).getAlbumInfo2},

	// Retrieval group (P9a, the retired server retrieval.ts). stream/download also answer
	// HEAD (the old Fastify auto-HEAD; R4 relies on it).
	{"stream", http.MethodGet, "/stream.view", (*Handler).stream},
	{"streamHEAD", http.MethodHead, "/stream.view", (*Handler).stream},
	{"download", http.MethodGet, "/download.view", (*Handler).download},
	{"downloadHEAD", http.MethodHead, "/download.view", (*Handler).download},
	{"getCoverArt", http.MethodGet, "/getCoverArt.view", (*Handler).getCoverArt},
	{"getLyrics", http.MethodGet, "/getLyrics.view", (*Handler).getLyrics},
	{"getAvatar", http.MethodGet, "/getAvatar.view", (*Handler).getAvatar},
	{"getInternetRadioStations", http.MethodGet, "/getInternetRadioStations.view", (*Handler).getInternetRadioStations},
	{"getPodcasts", http.MethodGet, "/getPodcasts.view", (*Handler).getPodcasts},
	{"getNewestPodcasts", http.MethodGet, "/getNewestPodcasts.view", (*Handler).getNewestPodcasts},

	// Starring group (P9b, the retired server starring.ts; scrobble rides along, T1-T4).
	{"star", http.MethodGet, "/star.view", (*Handler).star},
	{"unstar", http.MethodGet, "/unstar.view", (*Handler).unstar},
	{"setRating", http.MethodGet, "/setRating.view", (*Handler).setRating},
	{"scrobble", http.MethodGet, "/scrobble.view", (*Handler).scrobble},
	{"getStarred", http.MethodGet, "/getStarred.view", (*Handler).getStarred},
	{"getStarred2", http.MethodGet, "/getStarred2.view", (*Handler).getStarred2},

	// Activity group (P9b, the retired server now-playing.ts; N1 — the P8 players tracker).
	{"getNowPlaying", http.MethodGet, "/getNowPlaying.view", (*Handler).getNowPlaying},

	// Playlist group (P9b, the retired server playlists/opensubsonic-routes.ts; P1 — ONE policy).
	{"getPlaylists", http.MethodGet, "/getPlaylists.view", (*Handler).getPlaylists},
	{"getPlaylist", http.MethodGet, "/getPlaylist.view", (*Handler).getPlaylist},
	{"createPlaylist", http.MethodGet, "/createPlaylist.view", (*Handler).createPlaylist},
	{"updatePlaylist", http.MethodGet, "/updatePlaylist.view", (*Handler).updatePlaylist},
	{"deletePlaylist", http.MethodGet, "/deletePlaylist.view", (*Handler).deletePlaylist},

	// Bookmark group (P9b, the retired server bookmarks/routes.ts).
	{"getBookmarks", http.MethodGet, "/getBookmarks.view", (*Handler).getBookmarks},
	{"createBookmark", http.MethodGet, "/createBookmark.view", (*Handler).createBookmark},
	{"deleteBookmark", http.MethodGet, "/deleteBookmark.view", (*Handler).deleteBookmark},
}
