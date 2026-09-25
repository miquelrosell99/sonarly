package opensubsonic

import (
	"context"
	"database/sql"
	"encoding/xml"
	"errors"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
)

// Browsing group payloads (v1 routes/browsing.ts). The wire shapes mirror
// the v1 response objects field for field; the quirks doc (B/X groups)
// records where v2 deliberately deviates.

// MusicFolder is one getMusicFolders entry. v2 uses the real library id
// (quirks doc B1 fix); the name fallback for the admin-empty case comes from
// the library path basename.
type MusicFolder struct {
	ID   string `xml:"id,attr" json:"id"`
	Name string `xml:"name,attr" json:"name"`
}

type musicFoldersBody struct {
	MusicFolder []MusicFolder `xml:"musicFolder" json:"musicFolder"`
}

type musicFoldersPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	MusicFolders musicFoldersBody `xml:"musicFolders" json:"musicFolders"`
}

// Index is one first-letter artist bucket (B3).
type Index struct {
	Name   string   `xml:"name,attr" json:"name"`
	Artist []Artist `xml:"artist" json:"artist"`
}

type indexesBody struct {
	LastModified int64    `xml:"lastModified,attr" json:"lastModified"`
	Index        []Index  `xml:"index" json:"index"`
	Child        []string `xml:"child" json:"child"`
	Shortcut     []string `xml:"shortcut" json:"shortcut"`
}

type indexesPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Indexes indexesBody `xml:"indexes" json:"indexes"`
}

type artistsBody struct {
	IgnoredArticles string  `xml:"ignoredArticles,attr" json:"ignoredArticles"`
	Index           []Index `xml:"index" json:"index"`
}

type artistsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Artists artistsBody `xml:"artists" json:"artists"`
}

// ArtistWithAlbums is the getArtist shape: the Artist fields flattened plus
// the album children (v1's {artist: {..., album: [...]}}).
type ArtistWithAlbums struct {
	Artist
	Album []Album `xml:"album" json:"album"`
}

type artistPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Artist *ArtistWithAlbums `xml:"artist" json:"artist"`
}

type albumPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Album *Album `xml:"album" json:"album"`
}

type songPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Song *Song `xml:"song" json:"song"`
}

type albumListBody struct {
	Album []Album `xml:"album" json:"album"`
}

type albumListPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	AlbumList albumListBody `xml:"albumList" json:"albumList"`
}

type albumList2Payload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	AlbumList2 albumListBody `xml:"albumList2" json:"albumList2"`
}

type genresBody struct {
	Genre []Genre `xml:"genre" json:"genre"`
}

type genresPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Genres genresBody `xml:"genres" json:"genres"`
}

type searchResult3Body struct {
	Artist []Artist `xml:"artist" json:"artist,omitempty"`
	Album  []Album  `xml:"album" json:"album,omitempty"`
	Song   []Song   `xml:"song" json:"song,omitempty"`
}

type searchResult3Payload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	SearchResult3 searchResult3Body `xml:"searchResult3" json:"searchResult3"`
}

type songsBody struct {
	Song []Song `xml:"song" json:"song"`
}

type songsByGenrePayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	SongsByGenre songsBody `xml:"songsByGenre" json:"songsByGenre"`
}

type randomSongsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	RandomSongs songsBody `xml:"randomSongs" json:"randomSongs"`
}

type topSongsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	TopSongs songsBody `xml:"topSongs" json:"topSongs"`
}

type similarSongs2Payload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	SimilarSongs2 songsBody `xml:"similarSongs2" json:"similarSongs2"`
}

// SimilarArtist is the getArtistInfo2 similar-artist entry (v1 maps only
// id/name/coverArt/artistImageUrl — no albumCount or musicBrainzIds).
type SimilarArtist struct {
	ID             string `xml:"id,attr" json:"id"`
	Name           string `xml:"name,attr" json:"name"`
	CoverArt       string `xml:"coverArt,attr" json:"coverArt"`
	ArtistImageURL string `xml:"artistImageUrl,attr,omitempty" json:"artistImageUrl,omitempty"`
}

type artistInfo2Body struct {
	Biography      string          `xml:"biography,attr" json:"biography"`
	SmallImageURL  string          `xml:"smallImageUrl,attr,omitempty" json:"smallImageUrl,omitempty"`
	LargeImageURL  string          `xml:"largeImageUrl,attr,omitempty" json:"largeImageUrl,omitempty"`
	MusicBrainzID  string          `xml:"musicBrainzId,attr,omitempty" json:"musicBrainzId,omitempty"`
	SimilarArtists []SimilarArtist `xml:"similarArtist" json:"similarArtist"`
}

type artistInfo2Payload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	ArtistInfo2 artistInfo2Body `xml:"artistInfo2" json:"artistInfo2"`
}

// albumInfoBody is the deliberately misspelled-once shape both getAlbumInfo
// and getAlbumInfo2 answer with (quirks doc B5: the element is always named
// albumInfo so py-opensonic/Music Assistant doesn't KeyError).
type albumInfoBody struct {
	Notes         string `xml:"notes,attr" json:"notes"`
	MusicBrainzID string `xml:"musicBrainzId,attr,omitempty" json:"musicBrainzId,omitempty"`
}

type albumInfoPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	AlbumInfo albumInfoBody `xml:"albumInfo" json:"albumInfo"`
}

// getMusicFolders lists the caller's libraries (v1 browsing.ts:117-138,
// quirks doc B1). v2 emits the real library ids instead of v1's positional
// indexes; the admin-with-empty-table fallback keeps v1's
// basename(LIBRARY_PATH) behavior.
func (h *Handler) getMusicFolders(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	scope, err := libraries.GetScope(r.Context(), h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	folders := []MusicFolder{}
	switch {
	case scope.All:
		rows, err := h.db.QueryContext(r.Context(),
			`SELECT id, name FROM libraries ORDER BY name`)
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		defer rows.Close()
		for rows.Next() {
			var f MusicFolder
			if err := rows.Scan(&f.ID, &f.Name); err != nil {
				Error(w, r, CodeGeneric, "internal error")
				return
			}
			folders = append(folders, f)
		}
		if err := rows.Err(); err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		if len(folders) == 0 {
			name := filepath.Base(h.libraryPath)
			if name == "." || name == string(filepath.Separator) || name == "" {
				name = "library"
			}
			folders = append(folders, MusicFolder{ID: "0", Name: name})
		}
	case len(scope.IDs) > 0:
		rows, err := h.db.QueryContext(r.Context(),
			`SELECT id, name FROM libraries WHERE id IN (`+placeholders(len(scope.IDs))+`) ORDER BY name`,
			stringArgs(scope.IDs)...)
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		defer rows.Close()
		for rows.Next() {
			var f MusicFolder
			if err := rows.Scan(&f.ID, &f.Name); err != nil {
				Error(w, r, CodeGeneric, "internal error")
				return
			}
			folders = append(folders, f)
		}
		if err := rows.Err(); err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
	}

	respond(w, r, musicFoldersPayload{
		Envelope:     okEnvelope(),
		MusicFolders: musicFoldersBody{MusicFolder: folders},
	})
}

// getIndexes answers the letter-bucketed artist index (v1:140-165, B2/B3).
// v2's deliberate fix: lastModified is the newest in-scope song mtime (0 when
// the scope is empty), not v1's Date.now() per request.
func (h *Handler) getIndexes(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	scopeFilter := artistScopeFilter(scope)

	rows, err := h.db.QueryContext(ctx,
		`SELECT `+artistColumns+`, `+artistAlbumCountSQL+`
		FROM artists ar
		WHERE ar.active = 1 `+scopeFilter.SQL+`
		ORDER BY ar.name`, scopeFilter.Params...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	defer rows.Close()
	artists := []ArtistSource{}
	for rows.Next() {
		a, err := scanIndexArtistRow(rows)
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		artists = append(artists, a)
	}
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	mapped := make([]Artist, len(artists))
	for i := range artists {
		mapped[i] = MapArtist(artists[i], id.UserID != "")
	}
	respond(w, r, indexesPayload{
		Envelope: okEnvelope(),
		Indexes: indexesBody{
			LastModified: h.lastModified(ctx, scope),
			Index:        groupArtistsByInitial(mapped),
			Child:        []string{},
			Shortcut:     []string{},
		},
	})
}

// lastModified is the B2 fix: the max active in-scope song mtime, 0 when
// empty — stable until the library actually changes.
func (h *Handler) lastModified(ctx context.Context, scope libraries.Scope) int64 {
	c := libraries.ScopeCondition(scope, "s.library_id")
	var mtime sql.NullInt64
	err := h.db.QueryRowContext(ctx,
		`SELECT MAX(s.mtime) FROM songs s WHERE s.active = 1 `+c.SQL, c.Params...).Scan(&mtime)
	if err != nil || !mtime.Valid {
		return 0
	}
	return mtime.Int64
}

// groupArtistsByInitial buckets artists by uppercased first character with
// the '#' fallback (v1 groupArtistsByInitial, B3). Bucket order is
// codepoint order — for the single-letter ASCII buckets v1's localeCompare
// produced, that is identical.
func groupArtistsByInitial(artists []Artist) []Index {
	groups := make(map[string][]Artist)
	for _, a := range artists {
		initial := "#"
		if r, _ := utf8.DecodeRuneInString(a.Name); r != utf8.RuneError {
			initial = string(unicode.ToUpper(r))
		}
		groups[initial] = append(groups[initial], a)
	}
	names := make([]string, 0, len(groups))
	for name := range groups {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]Index, len(names))
	for i, name := range names {
		out[i] = Index{Name: name, Artist: groups[name]}
	}
	return out
}

// getArtists answers the letter-bucketed index including per-user
// interactions (v1:167-192).
func (h *Handler) getArtists(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	scopeFilter := artistScopeFilter(scope)

	rows, err := h.db.QueryContext(ctx,
		`SELECT `+artistColumns+`, `+artistAlbumCountSQL+`,
			uar.starred, uar.rating
		FROM artists ar
		LEFT JOIN user_artists uar ON uar.user_id = ? AND uar.artist_id = ar.id
		WHERE ar.active = 1 `+scopeFilter.SQL+`
		ORDER BY ar.name`, append([]any{id.UserID}, scopeFilter.Params...)...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	defer rows.Close()
	artists := []ArtistSource{}
	for rows.Next() {
		a, err := scanArtistRow(rows)
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		artists = append(artists, a)
	}
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	mapped := make([]Artist, len(artists))
	for i := range artists {
		mapped[i] = MapArtist(artists[i], id.UserID != "")
	}
	respond(w, r, artistsPayload{
		Envelope: okEnvelope(),
		Artists: artistsBody{
			IgnoredArticles: "",
			Index:           groupArtistsByInitial(mapped),
		},
	})
}

// getArtist answers one artist with its scoped albums (v1:267-319, B4/X15).
// albumCount is the length of the scoped album list, exactly like v1.
func (h *Handler) getArtist(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	albumID := r.URL.Query().Get("id")
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	artistScope := artistScopeFilter(scope)

	var (
		artistID string
		name     string
		imageURL sql.NullString
		mbIDs    sql.NullString
		starred  sql.NullInt64
		rating   sql.NullFloat64
	)
	err = h.db.QueryRowContext(ctx,
		`SELECT ar.id, ar.name, ar.artist_image_url, ar.musicbrainz_artist_ids, uar.starred, uar.rating
		FROM artists ar
		LEFT JOIN user_artists uar ON uar.user_id = ? AND uar.artist_id = ar.id
		WHERE ar.id = ? AND ar.active = 1 `+artistScope.SQL,
		append([]any{id.UserID, albumID}, artistScope.Params...)...).
		Scan(&artistID, &name, &imageURL, &mbIDs, &starred, &rating)
	if errors.Is(err, sql.ErrNoRows) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	albumScope := albumScopeFilter(scope)
	rows, err := h.db.QueryContext(ctx,
		albumSelect+`
		WHERE a.artist_id = ? AND a.active = 1 `+albumScope.SQL+`
		ORDER BY a.year, a.name`,
		append([]any{id.UserID, albumID}, albumScope.Params...)...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	defer rows.Close()
	albumRows := []AlbumSource{}
	for rows.Next() {
		a, err := scanAlbumRow(rows)
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		albumRows = append(albumRows, a)
	}
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	albums, err := h.mapAlbums(ctx, albumRows, id.UserID != "")
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	artist := ArtistWithAlbums{
		Artist: MapArtist(ArtistSource{
			ID:                 artistID,
			Name:               name,
			ArtistImageURL:     nullString(imageURL),
			MusicBrainzIDsJSON: nullStringToPtr(mbIDs),
			AlbumCount:         len(albums),
			Starred:            starred.Valid && starred.Int64 == 1,
			Rating:             nullFloat(rating),
		}, id.UserID != ""),
		Album: albums,
	}
	respond(w, r, artistPayload{Envelope: okEnvelope(), Artist: &artist})
}

// getAlbum answers one album with its scoped songs (v1:194-238, B4/X13).
func (h *Handler) getAlbum(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	albumID := r.URL.Query().Get("id")
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	scopeFilter := albumScopeFilter(scope)

	row := h.db.QueryRowContext(ctx,
		albumSelect+`
		WHERE a.id = ? AND a.active = 1 `+scopeFilter.SQL,
		append([]any{id.UserID, albumID}, scopeFilter.Params...)...)
	album, err := scanAlbumRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	songScope := libraries.ScopeCondition(scope, "s.library_id")
	rows, err := h.db.QueryContext(ctx,
		`SELECT `+songColumns+`,
			a.name AS album_name, ar.name AS artist_name, l.path AS library_path,
			us.starred, us.rating, us.play_count
		`+songJoins+`
		WHERE s.album_id = ? AND s.active = 1 `+songScope.SQL+`
		ORDER BY s.disc_number, s.track_number`,
		append([]any{id.UserID, albumID}, songScope.Params...)...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	defer rows.Close()
	songRows := []SongSource{}
	for rows.Next() {
		s, err := scanSongRow(rows)
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		songRows = append(songRows, s)
	}
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	songs, err := h.mapSongs(ctx, songRows, id.UserID != "")
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	duration := 0
	var maxMtime int64
	for _, s := range songRows {
		if s.Duration != nil {
			duration += *s.Duration
		}
		if s.MtimeMillis > maxMtime {
			maxMtime = s.MtimeMillis
		}
	}
	var createdAt *string
	if maxMtime > 0 {
		s := millisToISO(maxMtime)
		createdAt = &s
	}
	// v1's getAlbum loads the album's genre names and labels from the
	// junctions (artistEntries stay undefined — the artists fallback to the
	// album's primary artist columns, exactly like v1).
	genreNames, err := namesForMany(ctx, h.db, albumGenreJoin, []string{albumID})
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	labelEntries, err := entriesForMany(ctx, h.db, albumLabelJoin, []string{albumID})
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	mapped := MapAlbum(album, songs, duration, id.UserID != "", nil,
		genreNames[albumID], entryNames(labelEntries[albumID]), nil, createdAt)
	respond(w, r, albumPayload{Envelope: okEnvelope(), Album: &mapped})
}

// getSong answers one scoped song (v1:240-265, B4).
func (h *Handler) getSong(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	songID := r.URL.Query().Get("id")
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	songScope := libraries.ScopeCondition(scope, "s.library_id")

	row := h.db.QueryRowContext(ctx,
		`SELECT `+songColumns+`,
			a.name AS album_name, ar.name AS artist_name, l.path AS library_path,
			us.starred, us.rating, us.play_count
		`+songJoins+`
		WHERE s.id = ? AND s.active = 1 `+songScope.SQL,
		append([]any{id.UserID, songID}, songScope.Params...)...)
	song, err := scanSongRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	songs, err := h.mapSongs(ctx, []SongSource{song}, id.UserID != "")
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, songPayload{Envelope: okEnvelope(), Song: &songs[0]})
}

// getAlbumList/getAlbumList2 share v1's fetchAlbumList (B8).
func (h *Handler) getAlbumList(w http.ResponseWriter, r *http.Request) {
	h.albumList(w, r, false)
}

func (h *Handler) getAlbumList2(w http.ResponseWriter, r *http.Request) {
	h.albumList(w, r, true)
}

func (h *Handler) albumList(w http.ResponseWriter, r *http.Request, id3 bool) {
	id, _ := auth.IdentityFrom(r.Context())
	q := r.URL.Query()
	size := min(queryInt(q.Get("size"), 20), 500)
	offset := queryInt(q.Get("offset"), 0)
	albums, err := h.fetchAlbumList(r, id, q.Get("type"), size, offset, q.Get("genre"), q.Get("fromYear"), q.Get("toYear"))
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	body := albumListBody{Album: albums}
	if id3 {
		respond(w, r, albumList2Payload{Envelope: okEnvelope(), AlbumList2: body})
		return
	}
	respond(w, r, albumListPayload{Envelope: okEnvelope(), AlbumList: body})
}

// fetchAlbumList ports v1's fetchAlbumList (browsing.ts:1054-1157, B8):
// size clamped to 500, offset unclamped, unknown type falls back to
// alphabeticalByName, fromYear>toYear swapped, newest = per-album max song
// mtime, recent/frequent = per-user aggregates, random = RANDOM().
func (h *Handler) fetchAlbumList(r *http.Request, id auth.Identity, listType string, size, offset int, genre, fromYear, toYear string) ([]Album, error) {
	ctx := r.Context()
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	scopeFilter := albumScopeFilter(scope)

	stmt := albumSelect + `
	WHERE a.active = 1 ` + scopeFilter.SQL
	params := []any{id.UserID}
	params = append(params, scopeFilter.Params...)
	var orderParams []any

	if genre != "" {
		stmt += ` AND EXISTS (
			SELECT 1 FROM album_genres ag
			JOIN genres g ON g.id = ag.genre_id
			WHERE ag.album_id = a.id AND g.name = ?)`
		params = append(params, genre)
	}
	from, hasFrom := parseYear(fromYear)
	to, hasTo := parseYear(toYear)
	if hasFrom && hasTo {
		lo, hi := from, to
		if lo > hi {
			lo, hi = hi, lo
		}
		stmt += ` AND a.year >= ? AND a.year <= ?`
		params = append(params, lo, hi)
	}

	switch listType {
	case "alphabeticalByArtist":
		stmt += ` ORDER BY a.artist_name, a.name`
	case "alphabeticalByName":
		stmt += ` ORDER BY a.name`
	case "newest":
		stmt += ` ORDER BY (
			SELECT MAX(s2.mtime) FROM songs s2
			WHERE s2.album_id = a.id AND s2.active = 1
		) DESC NULLS LAST, a.name`
	case "recent":
		stmt += ` ORDER BY (
			SELECT MAX(us2.last_played)
			FROM user_songs us2
			JOIN songs s2 ON s2.id = us2.song_id AND s2.active = 1
			WHERE s2.album_id = a.id AND us2.user_id = ?
		) DESC NULLS LAST, a.name`
		orderParams = append(orderParams, id.UserID)
	case "frequent":
		stmt += ` ORDER BY (
			SELECT SUM(us2.play_count)
			FROM user_songs us2
			JOIN songs s2 ON s2.id = us2.song_id AND s2.active = 1
			WHERE s2.album_id = a.id AND us2.user_id = ?
		) DESC NULLS LAST, a.name`
		orderParams = append(orderParams, id.UserID)
	case "random":
		stmt += ` ORDER BY RANDOM()`
	case "byYear":
		stmt += ` ORDER BY a.year, a.name`
	case "byGenre":
		stmt += ` ORDER BY (
			SELECT g.name FROM album_genres ag
			JOIN genres g ON g.id = ag.genre_id
			WHERE ag.album_id = a.id
			ORDER BY ag.position LIMIT 1
		), a.name`
	default:
		stmt += ` ORDER BY a.name`
	}

	stmt += ` LIMIT ? OFFSET ?`
	params = append(params, orderParams...)
	params = append(params, size, offset)

	rows, err := h.db.QueryContext(ctx, stmt, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	albumRows := []AlbumSource{}
	for rows.Next() {
		a, err := scanAlbumRow(rows)
		if err != nil {
			return nil, err
		}
		albumRows = append(albumRows, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return h.mapAlbums(ctx, albumRows, id.UserID != "")
}

// getGenres answers the global genre list (v1:336-362, B10): counts from
// distinct active album/song joins, deliberately NOT library-scoped.
func (h *Handler) getGenres(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.QueryContext(r.Context(), `
		SELECT g.name AS value,
			(SELECT COUNT(DISTINCT ag.album_id)
				FROM album_genres ag
				JOIN albums a ON a.id = ag.album_id
				WHERE ag.genre_id = g.id AND a.active = 1) AS album_count,
			(SELECT COUNT(DISTINCT sg.song_id)
				FROM song_genres sg
				JOIN songs s ON s.id = sg.song_id
				WHERE sg.genre_id = g.id AND s.active = 1) AS song_count
		FROM genres g
		WHERE g.active = 1
		ORDER BY g.name`)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	defer rows.Close()
	genres := []Genre{}
	for rows.Next() {
		var g Genre
		if err := rows.Scan(&g.Value, &g.AlbumCount, &g.SongCount); err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		genres = append(genres, g)
	}
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, genresPayload{
		Envelope: okEnvelope(),
		Genres:   genresBody{Genre: genres},
	})
}

// search3 ports v1's search3 (browsing.ts:364-460, B6/B7): the
// empty/whitespace query is an unfiltered paginated browse; LIKE metachars
// escaped; count params default 20 and are clamped to 500 in v2 (B6 fix);
// artist hits carry the full Artist DTO incl. musicBrainzIds (B7 fix);
// result keys with no hits are omitted.
func (h *Handler) search3(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	q := r.URL.Query()
	term := strings.TrimSpace(q.Get("query"))
	term = strings.Trim(term, "\"'")
	artistCount := min(queryInt(q.Get("artistCount"), 20), 500)
	artistOffset := queryInt(q.Get("artistOffset"), 0)
	albumCount := min(queryInt(q.Get("albumCount"), 20), 500)
	albumOffset := queryInt(q.Get("albumOffset"), 0)
	songCount := min(queryInt(q.Get("songCount"), 20), 500)
	songOffset := queryInt(q.Get("songOffset"), 0)

	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	artistScope := artistScopeFilter(scope)
	albumScope := albumScopeFilter(scope)
	songScope := libraries.ScopeCondition(scope, "s.library_id")

	like := ""
	if term != "" {
		like = "%" + strings.NewReplacer(`%`, `\%`, `_`, `\_`).Replace(term) + "%"
	}
	result := searchResult3Body{}

	// Artists (B7: full Artist DTO incl. musicBrainzIds).
	artistSQL := `SELECT ` + artistColumns + `, ` + artistAlbumCountSQL + `,
			uar.starred, uar.rating
		FROM artists ar
		LEFT JOIN user_artists uar ON uar.user_id = ? AND uar.artist_id = ar.id
		WHERE ar.active = 1 ` + artistScope.SQL
	artistParams := []any{id.UserID}
	if like != "" {
		artistSQL += ` AND ar.name LIKE ?` + sqlLikeEscape
		artistParams = append(artistParams, like)
	}
	artistSQL += ` ORDER BY ar.name LIMIT ? OFFSET ?`
	artistParams = append(artistParams, artistScope.Params...)
	artistParams = append(artistParams, artistCount, artistOffset)

	rows, err := h.db.QueryContext(ctx, artistSQL, artistParams...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	artistRows := []ArtistSource{}
	for rows.Next() {
		a, err := scanArtistRow(rows)
		if err != nil {
			rows.Close()
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		artistRows = append(artistRows, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if len(artistRows) > 0 {
		result.Artist = make([]Artist, len(artistRows))
		for i := range artistRows {
			result.Artist[i] = MapArtist(artistRows[i], id.UserID != "")
		}
	}

	// Albums.
	albumSQL := albumSelect + `
	WHERE a.active = 1 ` + albumScope.SQL
	albumParams := []any{id.UserID}
	if like != "" {
		albumSQL += ` AND (a.name LIKE ?` + sqlLikeEscape + ` OR a.artist_name LIKE ?` + sqlLikeEscape + `)`
		albumParams = append(albumParams, like, like)
	}
	albumSQL += ` ORDER BY a.name LIMIT ? OFFSET ?`
	albumParams = append(albumParams, albumScope.Params...)
	albumParams = append(albumParams, albumCount, albumOffset)

	rows, err = h.db.QueryContext(ctx, albumSQL, albumParams...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	albumRows := []AlbumSource{}
	for rows.Next() {
		a, err := scanAlbumRow(rows)
		if err != nil {
			rows.Close()
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		albumRows = append(albumRows, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if len(albumRows) > 0 {
		result.Album, err = h.mapAlbums(ctx, albumRows, id.UserID != "")
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
	}

	// Songs.
	songSQL := `SELECT ` + songColumns + `,
			a.name AS album_name, ar.name AS artist_name, l.path AS library_path,
			us.starred, us.rating, us.play_count
		` + songJoins + `
		WHERE s.active = 1 ` + songScope.SQL
	songParams := []any{id.UserID}
	if like != "" {
		songSQL += ` AND (s.title LIKE ?` + sqlLikeEscape + ` OR ar.name LIKE ?` + sqlLikeEscape + ` OR a.name LIKE ?` + sqlLikeEscape + `)`
		songParams = append(songParams, like, like, like)
	}
	songSQL += ` ORDER BY s.title LIMIT ? OFFSET ?`
	songParams = append(songParams, songScope.Params...)
	songParams = append(songParams, songCount, songOffset)

	rows, err = h.db.QueryContext(ctx, songSQL, songParams...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	songRows := []SongSource{}
	for rows.Next() {
		s, err := scanSongRow(rows)
		if err != nil {
			rows.Close()
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		songRows = append(songRows, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if len(songRows) > 0 {
		result.Song, err = h.mapSongs(ctx, songRows, id.UserID != "")
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
	}

	respond(w, r, searchResult3Payload{Envelope: okEnvelope(), SearchResult3: result})
}

// getSongsByGenre ports v1:476-492 (B9): missing genre → 10, size default
// 10 clamped to 500.
func (h *Handler) getSongsByGenre(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	q := r.URL.Query()
	genre := q.Get("genre")
	if genre == "" {
		Error(w, r, CodeMissingParam, "Missing genre parameter")
		return
	}
	size := min(queryInt(q.Get("size"), 10), 500)
	offset := queryInt(q.Get("offset"), 0)

	songs, err := h.fetchSongsByGenre(r, id, genre, size, offset)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, songsByGenrePayload{
		Envelope:     okEnvelope(),
		SongsByGenre: songsBody{Song: songs},
	})
}

func (h *Handler) fetchSongsByGenre(r *http.Request, id auth.Identity, genre string, size, offset int) ([]Song, error) {
	ctx := r.Context()
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	songScope := libraries.ScopeCondition(scope, "s.library_id")
	rows, err := h.db.QueryContext(ctx,
		`SELECT `+songColumns+`,
			a.name AS album_name, ar.name AS artist_name, l.path AS library_path,
			us.starred, us.rating, us.play_count
		`+songJoins+`
		JOIN song_genres sg ON sg.song_id = s.id
		JOIN genres g ON g.id = sg.genre_id
		WHERE s.active = 1 AND g.name = ? `+songScope.SQL+`
		ORDER BY s.title
		LIMIT ? OFFSET ?`,
		append([]any{id.UserID, genre}, append(songScope.Params, size, offset)...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	songRows := []SongSource{}
	for rows.Next() {
		s, err := scanSongRow(rows)
		if err != nil {
			return nil, err
		}
		songRows = append(songRows, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return h.mapSongs(ctx, songRows, id.UserID != "")
}

// getRandomSongs ports v1:494-505: size default 10 clamped to 500, optional
// genre and year window filters, ORDER BY RANDOM().
func (h *Handler) getRandomSongs(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	q := r.URL.Query()
	size := min(queryInt(q.Get("size"), 10), 500)

	songs, err := h.fetchRandomSongs(r, id, size, q.Get("genre"), q.Get("fromYear"), q.Get("toYear"))
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, randomSongsPayload{
		Envelope:    okEnvelope(),
		RandomSongs: songsBody{Song: songs},
	})
}

func (h *Handler) fetchRandomSongs(r *http.Request, id auth.Identity, size int, genre, fromYear, toYear string) ([]Song, error) {
	ctx := r.Context()
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	songScope := libraries.ScopeCondition(scope, "s.library_id")
	params := []any{id.UserID}
	params = append(params, songScope.Params...)
	sql := `SELECT ` + songColumns + `,
			a.name AS album_name, ar.name AS artist_name, l.path AS library_path,
			us.starred, us.rating, us.play_count
		` + songJoins + `
		WHERE s.active = 1 ` + songScope.SQL

	if genre != "" {
		sql += ` AND EXISTS (
			SELECT 1 FROM song_genres sg
			JOIN genres g ON g.id = sg.genre_id
			WHERE sg.song_id = s.id AND g.name = ?)`
		params = append(params, genre)
	}
	from, hasFrom := parseYear(fromYear)
	to, hasTo := parseYear(toYear)
	if hasFrom && hasTo {
		lo, hi := from, to
		if lo > hi {
			lo, hi = hi, lo
		}
		sql += ` AND s.year >= ? AND s.year <= ?`
		params = append(params, lo, hi)
	}

	sql += ` ORDER BY RANDOM() LIMIT ?`
	params = append(params, size)

	rows, err := h.db.QueryContext(ctx, sql, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	songRows := []SongSource{}
	for rows.Next() {
		s, err := scanSongRow(rows)
		if err != nil {
			return nil, err
		}
		songRows = append(songRows, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return h.mapSongs(ctx, songRows, id.UserID != "")
}

// getTopSongs ports v1:599-614 (B9): missing artist → 10, count default 50
// clamped to 500, artist matched NOCASE across primary/junction/album-artist
// rows, most-played first (per-user play counts).
func (h *Handler) getTopSongs(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	q := r.URL.Query()
	artist := q.Get("artist")
	if artist == "" {
		Error(w, r, CodeMissingParam, "Missing artist parameter")
		return
	}
	count := min(queryInt(q.Get("count"), 50), 500)

	songs, err := h.fetchTopSongs(r, id, artist, count)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, topSongsPayload{
		Envelope: okEnvelope(),
		TopSongs: songsBody{Song: songs},
	})
}

func (h *Handler) fetchTopSongs(r *http.Request, id auth.Identity, artistName string, count int) ([]Song, error) {
	ctx := r.Context()
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	songScope := libraries.ScopeCondition(scope, "s.library_id")
	rows, err := h.db.QueryContext(ctx,
		`SELECT `+songColumns+`,
			a.name AS album_name, ar.name AS artist_name, l.path AS library_path,
			us.starred, us.rating, us.play_count
		`+songJoins+`
		WHERE s.active = 1
		`+songScope.SQL+`
		AND (
			ar.name = ? COLLATE NOCASE
			OR EXISTS (
				SELECT 1 FROM song_artists sa
				JOIN artists a2 ON a2.id = sa.artist_id
				WHERE sa.song_id = s.id AND a2.name = ? COLLATE NOCASE
			)
			OR EXISTS (
				SELECT 1 FROM album_artists aa
				JOIN artists a3 ON a3.id = aa.artist_id
				WHERE aa.album_id = s.album_id AND a3.name = ? COLLATE NOCASE
			)
		)
		GROUP BY s.id
		ORDER BY COALESCE(SUM(us.play_count), 0) DESC, s.title
		LIMIT ?`,
		append([]any{id.UserID}, append(songScope.Params, artistName, artistName, artistName, count)...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	songRows := []SongSource{}
	for rows.Next() {
		s, err := scanSongRow(rows)
		if err != nil {
			return nil, err
		}
		songRows = append(songRows, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return h.mapSongs(ctx, songRows, id.UserID != "")
}

// getSimilarSongs2 ports v1:580-597: the seed song must be active (B4);
// candidates come from the same artist (primary or junction) or, without an
// artist, the same album; scoped; RANDOM() order.
func (h *Handler) getSimilarSongs2(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	q := r.URL.Query()
	songID := q.Get("id")
	count := min(queryInt(q.Get("count"), 50), 500)

	ctx := r.Context()
	var artistID, albumID sql.NullString
	err := h.db.QueryRowContext(ctx,
		`SELECT artist_id, album_id FROM songs WHERE id = ? AND active = 1`, songID).
		Scan(&artistID, &albumID)
	if errors.Is(err, sql.ErrNoRows) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	songs, err := h.fetchSimilarSongs(r, id, songID, artistID, albumID, count)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, similarSongs2Payload{
		Envelope:      okEnvelope(),
		SimilarSongs2: songsBody{Song: songs},
	})
}

func (h *Handler) fetchSimilarSongs(r *http.Request, id auth.Identity, excludeID string, artistID, albumID sql.NullString, count int) ([]Song, error) {
	ctx := r.Context()
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	songScope := libraries.ScopeCondition(scope, "s.library_id")
	params := []any{id.UserID}
	where := `WHERE s.active = 1 AND s.id != ?`
	params = append(params, excludeID)
	where += ` ` + songScope.SQL
	params = append(params, songScope.Params...)

	switch {
	case artistID.Valid && artistID.String != "":
		where += ` AND (s.artist_id = ? OR EXISTS (
			SELECT 1 FROM song_artists sa WHERE sa.song_id = s.id AND sa.artist_id = ?))`
		params = append(params, artistID.String, artistID.String)
	case albumID.Valid && albumID.String != "":
		where += ` AND s.album_id = ?`
		params = append(params, albumID.String)
	default:
		return []Song{}, nil
	}

	rows, err := h.db.QueryContext(ctx,
		`SELECT `+songColumns+`,
			a.name AS album_name, ar.name AS artist_name, l.path AS library_path,
			us.starred, us.rating, us.play_count
		`+songJoins+` `+where+`
		ORDER BY RANDOM()
		LIMIT ?`, append(params, count)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	songRows := []SongSource{}
	for rows.Next() {
		s, err := scanSongRow(rows)
		if err != nil {
			return nil, err
		}
		songRows = append(songRows, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return h.mapSongs(ctx, songRows, id.UserID != "")
}

// getArtistInfo2 ports v1:507-555: metadata only — empty biography, the
// stored artist image URLs, the first stored musicBrainz id, and up to
// `count` (default 5, clamped 100) genre-sharing similar artists. v2 adds
// the library-scope check v1 omitted on this endpoint (P9 scope mandate;
// recorded under B4 in the quirks doc).
func (h *Handler) getArtistInfo2(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	artistID := r.URL.Query().Get("id")
	count := min(queryInt(r.URL.Query().Get("count"), 5), 100)

	var imageURL sql.NullString
	var mbIDs sql.NullString
	err := h.db.QueryRowContext(ctx,
		`SELECT artist_image_url, musicbrainz_artist_ids FROM artists WHERE id = ? AND active = 1`,
		artistID).Scan(&imageURL, &mbIDs)
	if errors.Is(err, sql.ErrNoRows) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	inScope, err := libraries.IsArtistInScope(ctx, h.db, scope, artistID)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if !inScope {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}

	rows, err := h.db.QueryContext(ctx, `
		SELECT id, name, artist_image_url FROM artists
		WHERE active = 1 AND id != ?
			AND EXISTS (
				SELECT 1 FROM album_genres ag
				JOIN albums a ON a.id = ag.album_id
				WHERE a.artist_id = artists.id
					AND ag.genre_id IN (
						SELECT ag2.genre_id FROM album_genres ag2
						JOIN albums a2 ON a2.id = ag2.album_id
						WHERE a2.artist_id = ?
					)
			)
		ORDER BY RANDOM()
		LIMIT ?`, artistID, artistID, count)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	defer rows.Close()
	similar := []SimilarArtist{}
	for rows.Next() {
		var s SimilarArtist
		var img sql.NullString
		if err := rows.Scan(&s.ID, &s.Name, &img); err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		s.CoverArt = s.ID
		s.ArtistImageURL = stringOr(nullString(img))
		similar = append(similar, s)
	}
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	info := artistInfo2Body{
		Biography:      "",
		SmallImageURL:  stringOr(nullString(imageURL)),
		LargeImageURL:  stringOr(nullString(imageURL)),
		SimilarArtists: similar,
	}
	if ids := parseStringArray(nullStringToPtr(mbIDs)); len(ids) > 0 {
		info.MusicBrainzID = ids[0]
	}
	respond(w, r, artistInfo2Payload{Envelope: okEnvelope(), ArtistInfo2: info})
}

// getAlbumInfo/getAlbumInfo2 both answer the albumInfo element (v1:557-578,
// B5). v2 adds the library-scope check v1 omitted (P9 scope mandate; B4).
func (h *Handler) getAlbumInfo(w http.ResponseWriter, r *http.Request) {
	h.albumInfo(w, r)
}

func (h *Handler) getAlbumInfo2(w http.ResponseWriter, r *http.Request) {
	h.albumInfo(w, r)
}

func (h *Handler) albumInfo(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	albumID := r.URL.Query().Get("id")

	var mbAlbumID sql.NullString
	err := h.db.QueryRowContext(ctx,
		`SELECT musicbrainz_album_id FROM albums WHERE id = ? AND active = 1`, albumID).
		Scan(&mbAlbumID)
	if errors.Is(err, sql.ErrNoRows) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	inScope, err := libraries.IsAlbumInScope(ctx, h.db, scope, albumID)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if !inScope {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}

	respond(w, r, albumInfoPayload{
		Envelope: okEnvelope(),
		AlbumInfo: albumInfoBody{
			Notes:         "",
			MusicBrainzID: stringOr(nullString(mbAlbumID)),
		},
	})
}

// ---------------------------------------------------------------------------
// Query-param parsing helpers (v1 Number/parseInt semantics)
// ---------------------------------------------------------------------------

// sqlLikeEscape is the LIKE escape clause v1 used (backslash escapes
// % and _, quirks doc B6).
const sqlLikeEscape = " ESCAPE '\\'"

// queryInt parses an integer query param with v1's Number.parseInt(value, 10)
// semantics: invalid or absent → the default. (parseInt(”) is NaN → the ||
// default in v1; ParseInt errors land on def here.)
func queryInt(raw string, def int) int {
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return n
}

// parseYear parses a fromYear/toYear param; invalid → not-present.
func parseYear(raw string) (int, bool) {
	if raw == "" {
		return 0, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false
	}
	return n, true
}

func nullStringToPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}
