package catalog

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

const (
	// defaultListLimit mirrors the old hardcoded 500-row catalog lists.
	defaultListLimit = 500
	maxListLimit     = 500
	// genreAlbumsLimit mirrors the old /api/genres/:id/albums clamp (1..20,
	// default 4).
	defaultGenreAlbumsLimit = 4
	maxGenreAlbumsLimit     = 20
)

// Handler wires the catalog service to HTTP. Route handlers parse and
// validate, the service enforces library scope, and the route layer maps
// sentinel errors to the Go server error contract ({"error": "..."}).
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers the catalog endpoints behind session auth, the same
// composition the users module uses.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/songs", h.listSongs)
		r.Get("/api/songs/{id}", h.getSong)
		r.Get("/api/albums", h.listAlbums)
		r.Get("/api/albums/{id}", h.getAlbum)
		r.Get("/api/artists", h.listArtists)
		r.Get("/api/artists/{id}", h.getArtist)
		r.Get("/api/artists/{id}/songs", h.listArtistSongs)
		r.Get("/api/genres", h.listGenres)
		r.Get("/api/genres/tree", h.genreTree)
		r.Get("/api/genres/{id}/albums", h.genreAlbums)
		r.Get("/api/years", h.listYears)
		r.Get("/api/cover-art/{id}", h.getCoverArt)
	})
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrNotFound) {
		httpserver.Error(w, http.StatusNotFound, "Not found")
		return
	}
	slog.ErrorContext(r.Context(), "catalog service error", "err", err)
	httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
}

func identity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}

// boolQuery parses a boolean query flag ("true", "1", ...); anything
// unparseable is false.
func boolQuery(r *http.Request, key string) bool {
	v, _ := strconv.ParseBool(r.URL.Query().Get(key))
	return v
}

// listLimit clamps the limit query parameter to (0, maxListLimit]; absent or
// invalid values fall back to def.
func listLimit(r *http.Request, key string, def, max int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return def
	}
	return min(n, max)
}

func (h *Handler) listSongs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	songs, err := h.svc.ListSongs(r.Context(), identity(r), SongFilter{
		AlbumID:      q.Get("albumId"),
		ArtistID:     q.Get("artistId"),
		GenreID:      q.Get("genreId"),
		LibraryID:    q.Get("libraryId"),
		HideExplicit: boolQuery(r, "hideExplicit"),
		Limit:        listLimit(r, "limit", defaultListLimit, maxListLimit),
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if songs == nil {
		songs = []Song{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"songs": songs})
}

func (h *Handler) getSong(w http.ResponseWriter, r *http.Request) {
	song, err := h.svc.GetSong(r.Context(), identity(r), chi.URLParam(r, "id"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"song": song})
}

func (h *Handler) listAlbums(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var year *int
	if raw := q.Get("year"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			year = &n
		}
	}
	albums, err := h.svc.ListAlbums(r.Context(), identity(r), AlbumFilter{
		ArtistID:     q.Get("artistId"),
		GenreID:      q.Get("genreId"),
		Year:         year,
		LibraryID:    q.Get("libraryId"),
		HideExplicit: boolQuery(r, "hideExplicit"),
		Limit:        listLimit(r, "limit", defaultListLimit, maxListLimit),
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if albums == nil {
		albums = []Album{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"albums": albums})
}

func (h *Handler) getAlbum(w http.ResponseWriter, r *http.Request) {
	album, songs, err := h.svc.GetAlbum(r.Context(), identity(r), chi.URLParam(r, "id"), boolQuery(r, "hideExplicit"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if songs == nil {
		songs = []Song{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"album": album, "songs": songs})
}

func (h *Handler) listArtists(w http.ResponseWriter, r *http.Request) {
	artists, err := h.svc.ListArtists(r.Context(), identity(r), r.URL.Query().Get("libraryId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if artists == nil {
		artists = []Artist{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"artists": artists})
}

func (h *Handler) getArtist(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	artist, songs, err := h.svc.GetArtist(r.Context(), identity(r), chi.URLParam(r, "id"), q.Get("libraryId"), boolQuery(r, "hideExplicit"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if songs == nil {
		songs = []Song{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"artist": artist, "songs": songs})
}

func (h *Handler) listArtistSongs(w http.ResponseWriter, r *http.Request) {
	songs, err := h.svc.ListArtistSongs(r.Context(), identity(r), chi.URLParam(r, "id"), boolQuery(r, "hideExplicit"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if songs == nil {
		songs = []Song{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"songs": songs})
}

func (h *Handler) listGenres(w http.ResponseWriter, r *http.Request) {
	genres, err := h.svc.ListGenres(r.Context(), identity(r), r.URL.Query().Get("libraryId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if genres == nil {
		genres = []Genre{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"genres": genres})
}

func (h *Handler) genreTree(w http.ResponseWriter, r *http.Request) {
	tree, err := h.svc.GenreTree(r.Context(), identity(r), r.URL.Query().Get("libraryId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if tree == nil {
		tree = []*GenreNode{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"tree": tree})
}

func (h *Handler) genreAlbums(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	albums, err := h.svc.GenreAlbums(r.Context(), identity(r), chi.URLParam(r, "id"),
		listLimit(r, "limit", defaultGenreAlbumsLimit, maxGenreAlbumsLimit),
		boolQuery(r, "hideExplicit"), q.Get("libraryId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if albums == nil {
		albums = []Album{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"albums": albums})
}

func (h *Handler) listYears(w http.ResponseWriter, r *http.Request) {
	years, err := h.svc.ListYears(r.Context(), identity(r))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if years == nil {
		years = []YearCount{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"years": years})
}

// getCoverArt serves the blob. The response is private-cacheable for a day:
// cover art changes are rare and the id is content-addressed in practice.
func (h *Handler) getCoverArt(w http.ResponseWriter, r *http.Request) {
	art, err := h.svc.GetCoverArt(r.Context(), identity(r), chi.URLParam(r, "id"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", coverArtContentType(art.Format))
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.WriteHeader(http.StatusOK)
	w.Write(art.Data)
}
