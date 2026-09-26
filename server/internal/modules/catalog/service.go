package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// ErrNotFound is the single not-found sentinel: routes answer 404 both when
// a row is missing and when it exists outside the caller's library scope, so
// out-of-scope ids cannot be probed (old behavior).
var ErrNotFound = errors.New("catalog: not found")

// Service is the catalog domain API. Every public method resolves the
// caller's library scope first and enforces it — list queries carry it as a
// WHERE condition, detail endpoints probe the policy one-shots and collapse
// a false answer into ErrNotFound.
type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service { return &Service{db: db} }

// scope resolves the identity's library scope.
func (s *Service) scope(ctx context.Context, id auth.Identity) (libraries.Scope, error) {
	return libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
}

// ListSongs answers /api/songs.
func (s *Service) ListSongs(ctx context.Context, id auth.Identity, f SongFilter) ([]Song, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	return listSongs(ctx, s.db, id.UserID, scope, f)
}

// GetSong answers /api/songs/{id}; out-of-scope ids are indistinguishable
// from missing ones.
func (s *Service) GetSong(ctx context.Context, id auth.Identity, songID string) (*Song, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	ok, err := libraries.IsSongInScope(ctx, s.db, scope, songID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	song, err := getSongByID(ctx, s.db, id.UserID, songID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return song, nil
}

// ListAlbums answers /api/albums.
func (s *Service) ListAlbums(ctx context.Context, id auth.Identity, f AlbumFilter) ([]Album, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	return listAlbums(ctx, s.db, id.UserID, scope, f)
}

// GetAlbum answers /api/albums/{id}: the album plus its in-scope songs in
// playing order. With hideExplicit the songs array and the shown count drop
// explicit tracks (wire parity); the album itself is never hidden by an
// explicit flag — only by scope.
func (s *Service) GetAlbum(ctx context.Context, id auth.Identity, albumID string, hideExplicit bool) (*Album, []Song, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	ok, err := libraries.IsAlbumInScope(ctx, s.db, scope, albumID)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, ErrNotFound
	}
	album, err := getAlbumByID(ctx, s.db, id.UserID, albumID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	songs, err := listSongsByAlbum(ctx, s.db, id.UserID, albumID, scope)
	if err != nil {
		return nil, nil, err
	}
	artists, genres, labels, err := albumRelations(ctx, s.db, albumID)
	if err != nil {
		return nil, nil, err
	}
	if len(artists) > 0 {
		album.Artists = artists
	}
	if len(genres) > 0 {
		album.Genres = genres
	}
	if len(labels) > 0 {
		album.LabelEntries = labels
	}
	album.TotalSongCount = len(songs)
	album.ShownSongCount = len(songs)
	visible := songs
	if hideExplicit {
		visible = nonExplicit(songs)
		album.ShownSongCount = len(visible)
	}
	for i := range songs {
		if songs[i].Explicit {
			album.Explicit = true
			break
		}
	}
	return album, visible, nil
}

// ListArtists answers /api/artists.
func (s *Service) ListArtists(ctx context.Context, id auth.Identity, libraryID string) ([]Artist, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	return listArtists(ctx, s.db, id.UserID, libraryID, scope)
}

// GetArtist answers /api/artists/{id}: the artist with its album cards and
// (Go-server addition over the retired server) its in-scope songs, so the artist page gets
// everything in one round trip. Songs are filtered like the album path.
func (s *Service) GetArtist(ctx context.Context, id auth.Identity, artistID, libraryID string, hideExplicit bool) (*Artist, []Song, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	ok, err := libraries.IsArtistInScope(ctx, s.db, scope, artistID)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, ErrNotFound
	}
	artist, err := getArtistByID(ctx, s.db, id.UserID, artistID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	albums, err := listAlbumsByArtist(ctx, s.db, id.UserID, artistID, libraryID, scope, hideExplicit)
	if err != nil {
		return nil, nil, err
	}
	if albums == nil {
		albums = []ArtistAlbum{}
	}
	artist.Albums = albums
	songs, err := listSongsByArtist(ctx, s.db, id.UserID, artistID, scope)
	if err != nil {
		return nil, nil, err
	}
	visible := songs
	if hideExplicit {
		visible = nonExplicit(songs)
	}
	return artist, visible, nil
}

// ListArtistSongs answers /api/artists/{id}/songs.
func (s *Service) ListArtistSongs(ctx context.Context, id auth.Identity, artistID string, hideExplicit bool) ([]Song, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	ok, err := libraries.IsArtistInScope(ctx, s.db, scope, artistID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	songs, err := listSongsByArtist(ctx, s.db, id.UserID, artistID, scope)
	if err != nil {
		return nil, err
	}
	if hideExplicit {
		return nonExplicit(songs), nil
	}
	return songs, nil
}

// ListGenres answers /api/genres: the flat, path-annotated list pruned to
// genres reachable under the scope.
func (s *Service) ListGenres(ctx context.Context, id auth.Identity, libraryID string) ([]Genre, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	genres, err := listGenres(ctx, s.db)
	if err != nil {
		return nil, err
	}
	allowed, err := s.allowedGenreIDs(ctx, scope, libraryID)
	if err != nil {
		return nil, err
	}
	paths := buildGenrePaths(genres)
	out := make([]Genre, 0, len(genres))
	for _, g := range genres {
		if allowed != nil && !allowed[g.ID] {
			continue
		}
		out = append(out, Genre{
			ID:       g.ID,
			Name:     g.Name,
			ParentID: g.ParentID,
			Path:     paths[g.ID],
			Active:   g.Active,
		})
	}
	return out, nil
}

// GenreTree answers /api/genres/tree with the pruned tree.
func (s *Service) GenreTree(ctx context.Context, id auth.Identity, libraryID string) ([]*GenreNode, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	genres, err := listGenres(ctx, s.db)
	if err != nil {
		return nil, err
	}
	allowed, err := s.allowedGenreIDs(ctx, scope, libraryID)
	if err != nil {
		return nil, err
	}
	return buildGenreTree(genres, allowed), nil
}

// GenreAlbums answers /api/genres/{id}/albums: a random sample of active
// albums carrying the genre, scoped like every other read. The genre must
// exist; a genre with no in-scope songs yields an empty list, not an error.
func (s *Service) GenreAlbums(ctx context.Context, id auth.Identity, genreID string, limit int, hideExplicit bool, libraryID string) ([]Album, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := getGenreByID(ctx, s.db, genreID); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	return genreAlbums(ctx, s.db, genreID, limit, hideExplicit, libraryID, scope)
}

// ListYears answers /api/years.
func (s *Service) ListYears(ctx context.Context, id auth.Identity) ([]YearCount, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	return listYears(ctx, s.db, scope)
}

// GetSongLyrics answers GET /api/songs/{id}/lyrics: the raw lyrics columns,
// scoped like every other song read (out-of-scope ids answer 404). The
// synced column may hold the one-data-path JSON-lines shape (a JSON array of
// {time, text}) or LRC text written by the lyrics PUT; the wire shape is a
// nullable LRC string either way.
func (s *Service) GetSongLyrics(ctx context.Context, id auth.Identity, songID string) (*Lyrics, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	ok, err := libraries.IsSongInScope(ctx, s.db, scope, songID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	var lyrics, synced sql.NullString
	err = s.db.QueryRowContext(ctx,
		`SELECT lyrics, synced_lyrics FROM songs WHERE id = ?`, songID).Scan(&lyrics, &synced)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load lyrics: %w", err)
	}
	out := &Lyrics{}
	if lyrics.Valid {
		out.Lyrics = &lyrics.String
	}
	if synced.Valid {
		out.SyncedLyrics = syncedWire(synced.String)
	}
	return out, nil
}

// syncedWire normalizes a synced_lyrics column for the wire: a stored
// JSON-lines array renders back to LRC text, anything else passes through
// as-is (the column may already hold LRC text from the lyrics PUT).
func syncedWire(raw string) *string {
	if parsed, ok := parseAnyColumn(sql.NullString{String: raw, Valid: true}); ok {
		if lines, ok := parsed.([]any); ok {
			wire := audio.FormatLRC(linesFromAny(lines))
			return &wire
		}
	}
	return &raw
}

// linesFromAny converts a decoded JSON-lines array back to typed lines;
// malformed entries keep their zero values (defensive, per the catalog JSON
// doctrine — one bad row must not 500 the endpoint).
func linesFromAny(lines []any) []audio.SyncedLyricLine {
	out := make([]audio.SyncedLyricLine, 0, len(lines))
	for _, item := range lines {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		line := audio.SyncedLyricLine{}
		if t, ok := m["time"].(float64); ok {
			line.Time = t
		}
		if text, ok := m["text"].(string); ok {
			line.Text = text
		}
		out = append(out, line)
	}
	return out
}

// GetCoverArt answers /api/cover-art/{id}: the blob when the cover belongs
// to a reachable active song (or its album's art), 404 otherwise.
func (s *Service) GetCoverArt(ctx context.Context, id auth.Identity, coverArtID string) (*CoverArt, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return nil, err
	}
	ok, err := libraries.IsCoverArtInScope(ctx, s.db, scope, coverArtID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	art, err := getCoverArtByID(ctx, s.db, coverArtID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return art, nil
}

// allowedGenreIDs mirrors the old resolveAllowedGenreIds: scope-restricted
// callers keep only genres touched by in-scope songs; the libraryId filter
// intersects with the genres of that one library. nil means unrestricted.
func (s *Service) allowedGenreIDs(ctx context.Context, scope libraries.Scope, libraryID string) (map[string]bool, error) {
	var allowed map[string]bool
	if !scope.All {
		var err error
		allowed, err = genreIDsForLibraries(ctx, s.db, scope.IDs)
		if err != nil {
			return nil, err
		}
	}
	if libraryID != "" {
		forLibrary, err := genreIDsForLibrary(ctx, s.db, libraryID)
		if err != nil {
			return nil, err
		}
		if allowed == nil {
			allowed = forLibrary
		} else {
			for id := range allowed {
				if !forLibrary[id] {
					delete(allowed, id)
				}
			}
		}
	}
	return allowed, nil
}

// nonExplicit filters a song slice down to non-explicit tracks, preserving
// the input order.
func nonExplicit(songs []Song) []Song {
	out := make([]Song, 0, len(songs))
	for _, s := range songs {
		if !s.Explicit {
			out = append(out, s)
		}
	}
	return out
}
