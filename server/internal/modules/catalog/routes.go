package catalog

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

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
// composition the users module uses. The catalog write surface (entity
// deletes, genre create/rename/move/delete) sits in its own admin-gated
// group, like the tags module.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/songs", h.listSongs)
		r.Get("/api/songs/{id}", h.getSong)
		r.Get("/api/songs/{id}/lyrics", h.getSongLyrics)
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
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth, h.mw.RequireAdmin)
		r.Delete("/api/songs/{id}", h.deleteSong)
		r.Delete("/api/albums/{id}", h.deleteAlbum)
		r.Delete("/api/artists/{id}", h.deleteArtist)
		r.Post("/api/genres", h.createGenre)
		r.Put("/api/genres/{id}", h.updateGenre)
		r.Delete("/api/genres/{id}", h.deleteGenre)
	})
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrNotFound) {
		httpserver.Error(w, http.StatusNotFound, "Not found")
		return
	}
	if isConflict(err) {
		httpserver.Error(w, http.StatusConflict, err.Error())
		return
	}
	slog.ErrorContext(r.Context(), "catalog service error", "err", err)
	httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
}

// isConflict reports whether err is one of the admin-write conflict
// sentinels (duplicate genre name, artist still carrying active songs,
// genre still carrying active children) — all answer 409 with their
// message.
func isConflict(err error) bool {
	return errors.Is(err, ErrGenreExists) || errors.Is(err, ErrArtistHasSongs) || errors.Is(err, ErrGenreHasChildren)
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

// getSongLyrics is GET /api/songs/{id}/lyrics (auth, library-scoped): the
// plain and synced lyrics as nullable strings; out-of-scope ids answer 404
// like every other song read.
func (h *Handler) getSongLyrics(w http.ResponseWriter, r *http.Request) {
	lyrics, err := h.svc.GetSongLyrics(r.Context(), identity(r), chi.URLParam(r, "id"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"lyrics": lyrics})
}

func (h *Handler) deleteSong(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteSong(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) deleteAlbum(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteAlbum(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) deleteArtist(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteArtist(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// genreBody decodes a genre write body with the strict allowlist the tags
// module uses for tag edits (Q8 mass-assignment discipline: unknown keys
// are rejected, never silently dropped). Both writes accept `name` and
// `parentId`; a JSON null parentId means "move to the root" (the shape the
// admin move UI sends). POST requires a name; PUT (requireName false)
// requires at least one of the two fields.
func genreBody(w http.ResponseWriter, r *http.Request, requireName bool) (name string, hasName bool, parentID string, hasParent bool, ok bool) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return "", false, "", false, false
	}
	allowed := map[string]bool{"name": true, "parentId": true}
	for key := range body {
		if !allowed[key] {
			httpserver.Error(w, http.StatusBadRequest, "Unknown genre field: "+key)
			return "", false, "", false, false
		}
	}
	if raw, present := body["name"]; present {
		s, isString := raw.(string)
		if !isString || strings.TrimSpace(s) == "" {
			httpserver.Error(w, http.StatusBadRequest, "Genre name is required")
			return "", false, "", false, false
		}
		name, hasName = strings.TrimSpace(s), true
	}
	if raw, present := body["parentId"]; present {
		hasParent = true
		if raw != nil {
			s, isString := raw.(string)
			if !isString {
				httpserver.Error(w, http.StatusBadRequest, "parentId must be a string or null")
				return "", false, "", false, false
			}
			parentID = s
		}
	}
	if requireName && !hasName {
		httpserver.Error(w, http.StatusBadRequest, "Genre name is required")
		return "", false, "", false, false
	}
	if !requireName && !hasName && !hasParent {
		httpserver.Error(w, http.StatusBadRequest, "Genre name or parentId is required")
		return "", false, "", false, false
	}
	return name, hasName, parentID, hasParent, true
}

// createGenre is POST /api/genres (admin): {name, parentId?} -> 201 {genre}.
func (h *Handler) createGenre(w http.ResponseWriter, r *http.Request) {
	name, _, parentID, _, ok := genreBody(w, r, true)
	if !ok {
		return
	}
	genre, err := h.svc.CreateGenre(r.Context(), name, parentID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusCreated, map[string]any{"genre": genre})
}

// updateGenre is PUT /api/genres/{id} (admin): {name?, parentId?} -> {genre}.
// A name renames (the denormalized songs/albums genre-name cache follows,
// service); a parentId moves — null or empty string makes the genre a root.
// Both may ride one request, mirroring the retired server's updateGenre.
func (h *Handler) updateGenre(w http.ResponseWriter, r *http.Request) {
	name, hasName, parentID, hasParent, ok := genreBody(w, r, false)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	var (
		genre Genre
		err   error
	)
	if hasName {
		genre, err = h.svc.RenameGenre(r.Context(), id, name)
	}
	if err == nil && hasParent {
		genre, err = h.svc.MoveGenre(r.Context(), id, parentID)
	}
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"genre": genre})
}

// deleteGenre is DELETE /api/genres/{id} (admin) -> {ok:true}. Genres with
// active children answer 409; songs/albums carrying the genre survive with
// their genre_id nulled (service).
func (h *Handler) deleteGenre(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteGenre(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
