// Package tags is the tag-mutation surface (P9c): song/album tag editing
// and cover-art upload/delete, ported from the old features/songs/routes.ts
// (applySongTags, validateSongTags, the cover-art endpoints) and
// features/albums/routes.ts (the album-wide variants).
//
// The write path is the old one: python3 + mutagen behind the audio.TagWriter
// interface (see internal/audio/write.go). After a tag write the file is
// re-organized when its tags change the pattern target (old
// organizeSongFile), the database is refreshed through library.PersistSong
// — the ONE data path, reading the freshly tagged file — and a resync job
// is queued (the P4b queue coalesces, so an album-wide edit collapses into
// one pending resync per library, the retired server B6 lesson).
//
// Read-only doctrine deviation: the retired server wrote uploaded cover art INTO the audio
// files via mutagen. The Go server never mutates audio files outside tag editing; an
// upload stores the blob (hash-dedup) and links it on the song/album row,
// which is what every reader consults.
package tags

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

func trimSpace(s string) string { return strings.TrimSpace(s) }

func equalFold(a, b string) bool { return strings.EqualFold(a, b) }

func newID() string { return uuid.NewString() }

// Service owns the tag-edit flows.
type Service struct {
	db     *sql.DB
	writer audio.TagWriter
	ingest *ingest.Service
	queue  *library.Queue
}

// NewService constructs the tag-edit service. writer is the audio.TagWriter
// (production: audio.NewMutagenWriter); ingestSvc supplies the post-write
// re-organization; queue is the library job queue.
func NewService(db *sql.DB, writer audio.TagWriter, ingestSvc *ingest.Service, queue *library.Queue) *Service {
	return &Service{db: db, writer: writer, ingest: ingestSvc, queue: queue}
}

// SongTagsInput is the validated tag-edit payload (old SongTags). A nil
// field is absent — the file and the database keep their value.
type SongTagsInput struct {
	Title       *string
	Artist      []string // present (possibly empty after normalization) when the key was sent
	Album       *string
	AlbumArtist []string
	TrackNumber *int
	DiscNumber  *int
	Genre       []string
	Year        *int
	Explicit    *bool
	Lyrics      *string

	artistSet      bool
	albumArtistSet bool
	genreSet       bool
}

// ErrValidation marks a 400 from the tag payload validation, carrying the old
// message text.
type ErrValidation struct{ Message string }

func (e *ErrValidation) Error() string { return e.Message }

// validateSongTags ports the old validateSongTags: the explicit allowlist and
// per-field type checks. Unknown keys are rejected (Q8 mass-assignment
// discipline), never silently dropped.
func validateSongTags(body map[string]any) (*SongTagsInput, error) {
	allowed := map[string]bool{
		"title": true, "artist": true, "album": true, "albumArtist": true,
		"trackNumber": true, "discNumber": true, "genre": true, "year": true,
		"explicit": true, "lyrics": true,
	}
	for key := range body {
		if !allowed[key] {
			return nil, &ErrValidation{Message: "Unknown tag field: " + key}
		}
	}
	in := &SongTagsInput{}
	if v, ok := body["title"]; ok {
		s, ok := v.(string)
		if !ok {
			return nil, &ErrValidation{Message: "title must be a string"}
		}
		in.Title = &s
	}
	if v, ok := body["artist"]; ok {
		values, err := stringOrArray(v, "artist")
		if err != nil {
			return nil, err
		}
		in.Artist, in.artistSet = values, true
	}
	if v, ok := body["album"]; ok {
		s, ok := v.(string)
		if !ok {
			return nil, &ErrValidation{Message: "album must be a string"}
		}
		in.Album = &s
	}
	if v, ok := body["albumArtist"]; ok {
		values, err := stringOrArray(v, "albumArtist")
		if err != nil {
			return nil, err
		}
		in.AlbumArtist, in.albumArtistSet = values, true
	}
	if v, ok := body["trackNumber"]; ok {
		n, ok := v.(float64)
		if !ok || n != float64(int(n)) {
			return nil, &ErrValidation{Message: "trackNumber must be an integer"}
		}
		i := int(n)
		in.TrackNumber = &i
	}
	if v, ok := body["discNumber"]; ok {
		n, ok := v.(float64)
		if !ok || n != float64(int(n)) {
			return nil, &ErrValidation{Message: "discNumber must be an integer"}
		}
		i := int(n)
		in.DiscNumber = &i
	}
	if v, ok := body["genre"]; ok {
		values, err := stringOrArray(v, "genre")
		if err != nil {
			return nil, err
		}
		in.Genre, in.genreSet = values, true
	}
	if v, ok := body["year"]; ok {
		n, ok := v.(float64)
		if !ok || n != float64(int(n)) {
			return nil, &ErrValidation{Message: "year must be an integer"}
		}
		i := int(n)
		in.Year = &i
	}
	if v, ok := body["explicit"]; ok {
		b, ok := v.(bool)
		if !ok {
			return nil, &ErrValidation{Message: "explicit must be a boolean"}
		}
		in.Explicit = &b
	}
	if v, ok := body["lyrics"]; ok {
		s, ok := v.(string)
		if !ok {
			return nil, &ErrValidation{Message: "lyrics must be a string"}
		}
		in.Lyrics = &s
	}
	return in, nil
}

// stringOrArray ports the old validateStringOrArray + normalizeMultiValue:
// accept a string or an array of strings; normalize to trimmed non-empty
// values; a key sent with no usable values normalizes to nil.
func stringOrArray(v any, field string) ([]string, error) {
	switch value := v.(type) {
	case string:
		trimmed := trimNonEmpty([]string{value})
		return trimmed, nil
	case []any:
		strings := make([]string, 0, len(value))
		for _, item := range value {
			s, ok := item.(string)
			if !ok {
				return nil, &ErrValidation{Message: field + " must be a string or an array of strings"}
			}
			strings = append(strings, s)
		}
		return trimNonEmpty(strings), nil
	default:
		return nil, &ErrValidation{Message: field + " must be a string or an array of strings"}
	}
}

func trimNonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if t := trimSpace(v); t != "" {
			out = append(out, t)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// writerTags converts the validated input into the audio.SongTags payload.
// Normalized lists are passed only when the key was present.
func (in *SongTagsInput) writerTags() audio.SongTags {
	t := audio.SongTags{
		Title:       in.Title,
		Album:       in.Album,
		TrackNumber: in.TrackNumber,
		DiscNumber:  in.DiscNumber,
		Year:        in.Year,
		Explicit:    in.Explicit,
		Lyrics:      in.Lyrics,
	}
	if in.artistSet {
		t.Artist = in.Artist
	}
	if in.albumArtistSet {
		t.AlbumArtist = in.AlbumArtist
	}
	if in.genreSet {
		t.Genre = in.Genre
	}
	return t
}

// ---------------------------------------------------------------------------
// applySongTags (old port)
// ---------------------------------------------------------------------------

// songRow is the slice of the songs table the tag-edit flow needs.
type songRow struct {
	id       string
	filePath string
	artistID *string
	albumID  *string
	title    string
	artist   string
	album    string
}

func (s *Service) loadSong(ctx context.Context, id string) (*songRow, error) {
	var row songRow
	err := s.db.QueryRowContext(ctx,
		`SELECT s.id, s.file_path, s.artist_id, s.album_id, s.title,
		        COALESCE(ar.name, ''), COALESCE(al.name, '')
		 FROM songs s
		 LEFT JOIN artists ar ON ar.id = s.artist_id
		 LEFT JOIN albums al ON al.id = s.album_id
		 WHERE s.id = ?`, id).
		Scan(&row.id, &row.filePath, &row.artistID, &row.albumID, &row.title, &row.artist, &row.album)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load song %s: %w", id, err)
	}
	return &row, nil
}

// OrphanedEntity is an old applySongTags orphan report entry: an artist or
// album left with no other active songs after the edit.
type OrphanedEntity struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// applyResult is the outcome of one song tag edit.
type applyResult struct {
	orphaned []OrphanedEntity
}

// stageError pairs a failure message with the HTTP status the retired server answered. The
// tag-edit flow can fail mid-way (tags written, file moved, DB updated);
// the old server reported each stage with its own message and status.
type stageError struct {
	status  int
	message string
}

func (e *stageError) Error() string { return e.message }

// applySongTags ports the old applySongTags: write tags, re-organize the file,
// refresh the database through PersistSong, queue a resync, and report
// entities orphaned by the rename.
func (s *Service) applySongTags(ctx context.Context, id string, in *SongTagsInput) (*applyResult, error) {
	song, err := s.loadSong(ctx, id)
	if err != nil {
		return nil, err
	}
	if song == nil {
		return nil, &stageError{status: 404, message: "Song not found"}
	}

	if err := s.writer.Write(ctx, song.filePath, in.writerTags()); err != nil {
		return nil, &stageError{status: 500, message: "Failed to write tags"}
	}

	newPath, err := s.ingest.OrganizeSongFile(ctx, song.filePath)
	if err != nil {
		return nil, &stageError{status: 500, message: "Tags were saved but the file could not be reorganized"}
	}

	if err := s.persistFresh(ctx, song.id, newPath); err != nil {
		return nil, &stageError{status: 500, message: "Tags saved and file reorganized, but the database update failed"}
	}
	if err := s.queueResync(ctx, newPath); err != nil {
		return nil, &stageError{status: 500, message: "Tags saved and file reorganized, but resync queue failed"}
	}

	return &applyResult{orphaned: s.findOrphaned(ctx, song, in)}, nil
}

// persistFresh re-reads the freshly tagged file and persists it through the
// one data path. KeepCoverArt is false: the file is the source of truth for
// its own cover link after a tag write (wire parity — the old manual UPDATE plus
// resync converged to the same state).
func (s *Service) persistFresh(ctx context.Context, songID, path string) error {
	meta, err := audio.ReadMetadata(path)
	if err != nil {
		return fmt.Errorf("read metadata: %w", err)
	}
	info, err := statFile(path)
	if err != nil {
		return err
	}
	checksum, err := library.ChecksumFile(path)
	if err != nil {
		return err
	}
	libraryID, err := library.ResolveLibraryIDForPath(ctx, s.db, path)
	if err != nil {
		return err
	}
	_, err = library.PersistSong(ctx, s.db, library.PersistInput{
		ExistingID: &songID,
		Path:       path,
		Meta:       meta,
		Mtime:      info.ModTime().UnixMilli(),
		Checksum:   checksum,
		LibraryID:  libraryID,
	})
	return err
}

// queueResync pushes a coalescible resync for the library holding path.
func (s *Service) queueResync(ctx context.Context, path string) error {
	libraryID, err := library.ResolveLibraryIDForPath(ctx, s.db, path)
	if err != nil {
		return err
	}
	payload := library.ScanPayload{}
	if libraryID != nil {
		payload.LibraryID = *libraryID
	}
	_, err = s.queue.Push(ctx, library.JobTypeResync, payload)
	return err
}

// findOrphaned ports the old findOrphanedEntities: the pre-edit primary artist
// or album is reported when the edit renamed it away and no other active
// song references it.
func (s *Service) findOrphaned(ctx context.Context, song *songRow, in *SongTagsInput) []OrphanedEntity {
	var orphaned []OrphanedEntity
	newArtist := joinNames(in.Artist, in.artistSet)
	if song.artistID != nil && newArtist != nil {
		var name string
		if err := s.db.QueryRowContext(ctx,
			`SELECT name FROM artists WHERE id = ?`, *song.artistID).Scan(&name); err == nil &&
			!equalFold(*newArtist, name) {
			var count int
			if err := s.db.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM songs WHERE artist_id = ? AND id != ? AND active = 1`,
				*song.artistID, song.id).Scan(&count); err == nil && count == 0 {
				orphaned = append(orphaned, OrphanedEntity{Type: "artist", ID: *song.artistID, Name: name})
			}
		}
	}
	newAlbum := in.Album
	if song.albumID != nil && newAlbum != nil && *newAlbum != "" {
		var name string
		if err := s.db.QueryRowContext(ctx,
			`SELECT name FROM albums WHERE id = ?`, *song.albumID).Scan(&name); err == nil &&
			!equalFold(*newAlbum, name) {
			var count int
			if err := s.db.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM songs WHERE album_id = ? AND id != ? AND active = 1`,
				*song.albumID, song.id).Scan(&count); err == nil && count == 0 {
				orphaned = append(orphaned, OrphanedEntity{Type: "album", ID: *song.albumID, Name: name})
			}
		}
	}
	return orphaned
}

// joinNames mirrors the old joinNames for the orphan check: multi-value
// artists join with " / ".
func joinNames(values []string, set bool) *string {
	if !set {
		return nil
	}
	joined := ""
	for _, v := range values {
		if joined != "" {
			joined += " / "
		}
		joined += v
	}
	if joined == "" {
		return nil
	}
	return &joined
}

// ---------------------------------------------------------------------------
// Album-wide tag edit (old features/albums/routes.ts port)
// ---------------------------------------------------------------------------

// albumRow is the slice of the albums table the album tag-edit needs.
type albumRow struct {
	id         string
	name       string
	artistID   *string
	artistName *string
	genreID    *string
	genre      *string
	year       *int
}

func (s *Service) loadAlbum(ctx context.Context, id string) (*albumRow, error) {
	var row albumRow
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, artist_id, artist_name, genre_id, genre, year FROM albums WHERE id = ? AND active = 1`, id).
		Scan(&row.id, &row.name, &row.artistID, &row.artistName, &row.genreID, &row.genre, &row.year)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load album %s: %w", id, err)
	}
	return &row, nil
}

// albumSongs lists the album's songs in playing order (old listSongsByAlbum).
func (s *Service) albumSongs(ctx context.Context, albumID string) ([]songRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.id, s.file_path, s.artist_id, s.album_id, s.title,
		        COALESCE(ar.name, ''), COALESCE(al.name, '')
		 FROM songs s
		 LEFT JOIN artists ar ON ar.id = s.artist_id
		 LEFT JOIN albums al ON al.id = s.album_id
		 WHERE s.album_id = ?
		 ORDER BY s.disc_number, s.track_number`, albumID)
	if err != nil {
		return nil, fmt.Errorf("list album songs: %w", err)
	}
	defer rows.Close()
	var songs []songRow
	for rows.Next() {
		var row songRow
		if err := rows.Scan(&row.id, &row.filePath, &row.artistID, &row.albumID,
			&row.title, &row.artist, &row.album); err != nil {
			return nil, fmt.Errorf("list album songs: %w", err)
		}
		songs = append(songs, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list album songs: %w", err)
	}
	return songs, nil
}

// applyAlbumTags ports the old PUT /api/albums/:id/tags. releaseType is
// album-level metadata, validated by the caller and applied here. The
// per-song file writes exclude genre (old deletes it from the written set):
// genre is an album junction update, not a file tag, in the album flow.
func (s *Service) applyAlbumTags(ctx context.Context, albumID string, in *SongTagsInput, releaseType *string) (int, error) {
	album, err := s.loadAlbum(ctx, albumID)
	if err != nil {
		return 0, err
	}
	if album == nil {
		return 0, &stageError{status: 404, message: "Album not found"}
	}
	songs, err := s.albumSongs(ctx, albumID)
	if err != nil {
		return 0, err
	}

	fileTags := in.writerTags()
	fileTags.Genre = nil // old: genre is not written into files on album edits

	// Album row FIRST: renaming it before PersistSong runs means the
	// per-song ensure-album finds the renamed row and the songs stay on it
	// (old achieved the same by updating the row and then resyncing).
	if err := s.updateAlbumRow(ctx, album, in, releaseType); err != nil {
		return 0, err
	}

	for i := range songs {
		song := &songs[i]
		if err := s.writer.Write(ctx, song.filePath, fileTags); err != nil {
			return 0, &stageError{status: 500, message: "Failed to write tags"}
		}
		newPath, err := s.ingest.OrganizeSongFile(ctx, song.filePath)
		if err != nil {
			return 0, &stageError{status: 500, message: "Tags were saved but a file could not be reorganized"}
		}
		if err := s.persistFresh(ctx, song.id, newPath); err != nil {
			return 0, &stageError{status: 500, message: "Tags saved and files reorganized, but the database update failed"}
		}
	}
	// ONE coalesced resync for the whole album edit (old queued one per file;
	// the P4b queue collapses identical pending payloads into a single job).
	if len(songs) > 0 {
		if err := s.queueResync(ctx, songs[0].filePath); err != nil {
			return 0, &stageError{status: 500, message: "Tags saved and files reorganized, but resync queue failed"}
		}
	}
	return len(songs), nil
}

// updateAlbumRow applies the album-level update (the old SQL block): name,
// album artist, year, genre, release type, and the artist/genre junctions.
func (s *Service) updateAlbumRow(ctx context.Context, album *albumRow, in *SongTagsInput, releaseType *string) error {
	name := album.name
	if in.Title != nil {
		if trimmed := trimSpace(*in.Title); trimmed != "" {
			name = trimmed
		}
	}
	year := album.year
	if in.Year != nil {
		y := *in.Year
		year = &y
	}

	// Album artists: ensure rows, primary id, and the junction rewrite.
	var artistIDs []string
	artistName := album.artistName
	if in.albumArtistSet {
		joined := joinNames(in.AlbumArtist, true)
		artistName = joined
		if in.AlbumArtist != nil {
			for _, n := range in.AlbumArtist {
				id, err := library.EnsureArtist(ctx, s.db, n, nil)
				if err != nil {
					return fmt.Errorf("ensure album artist: %w", err)
				}
				artistIDs = append(artistIDs, id)
			}
		}
	}

	// Genre: resolve path-or-name, creating the genre when unknown (old
	// resolveGenreForTagWrite).
	var genreID, genreName *string
	if in.genreSet && in.Genre != nil {
		id, canonical, err := s.resolveGenreForTagWrite(ctx, in.Genre[0])
		if err != nil {
			return err
		}
		genreID, genreName = &id, &canonical
	} else {
		genreID, genreName = album.genreID, album.genre
	}

	var primaryArtistID *string
	if len(artistIDs) > 0 {
		primaryArtistID = &artistIDs[0]
	} else if in.albumArtistSet && in.AlbumArtist == nil {
		// old: an explicit empty albumArtist clears the album artist.
		primaryArtistID = nil
		artistName = nil
	} else {
		primaryArtistID = album.artistID
	}

	var genreValue any
	if genreID != nil {
		genreValue = *genreID
	}
	var genreNameValue any
	if genreName != nil {
		genreNameValue = *genreName
	}
	var yearValue any
	if year != nil {
		yearValue = *year
	}
	var artistNameValue any
	if artistName != nil {
		artistNameValue = *artistName
	}
	var artistIDValue any
	if primaryArtistID != nil {
		artistIDValue = *primaryArtistID
	}

	res, err := s.db.ExecContext(ctx,
		`UPDATE albums SET name = ?, artist_id = ?, artist_name = ?, year = ?, genre_id = ?, genre = ? WHERE id = ?`,
		name, artistIDValue, artistNameValue, yearValue, genreValue, genreNameValue, album.id)
	if err != nil {
		return fmt.Errorf("update album: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return &stageError{status: 404, message: "Album not found"}
	}

	if in.albumArtistSet && artistIDs != nil {
		if err := setJunction(ctx, s.db, "album_artists", "album_id", "artist_id", album.id, artistIDs); err != nil {
			return err
		}
	}
	if in.genreSet && in.Genre != nil && genreID != nil {
		if err := setJunction(ctx, s.db, "album_genres", "album_id", "genre_id", album.id, []string{*genreID}); err != nil {
			return err
		}
	}
	if releaseType != nil {
		var value any
		if trimmed := trimSpace(*releaseType); trimmed != "" {
			value = trimmed
		}
		if _, err := s.db.ExecContext(ctx,
			`UPDATE albums SET release_type = ? WHERE id = ?`, value, album.id); err != nil {
			return fmt.Errorf("update release type: %w", err)
		}
	}
	return nil
}

// resolveGenreForTagWrite ports the old resolveGenreForTagWrite: match an
// existing genre by full path ("Rock > Indie") or name (NOCASE), else
// create it.
func (s *Service) resolveGenreForTagWrite(ctx context.Context, genre string) (string, string, error) {
	trimmed := trimSpace(genre)
	if trimmed == "" {
		return "", "", &ErrValidation{Message: "Genre name cannot be empty"}
	}
	type genreRow struct {
		id       string
		name     string
		parentID *string
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, parent_id FROM genres WHERE active = 1`)
	if err != nil {
		return "", "", fmt.Errorf("list genres: %w", err)
	}
	var all []genreRow
	for rows.Next() {
		var g genreRow
		if err := rows.Scan(&g.id, &g.name, &g.parentID); err != nil {
			rows.Close()
			return "", "", fmt.Errorf("list genres: %w", err)
		}
		all = append(all, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", "", fmt.Errorf("list genres: %w", err)
	}
	byID := make(map[string]genreRow, len(all))
	for _, g := range all {
		byID[g.id] = g
	}
	pathOf := func(g genreRow) string {
		var parts []string
		visited := map[string]bool{}
		for cur := &g; cur != nil && !visited[cur.id]; {
			visited[cur.id] = true
			parts = append([]string{cur.name}, parts...)
			if cur.parentID == nil {
				break
			}
			parent, ok := byID[*cur.parentID]
			if !ok {
				break
			}
			cur = &parent
		}
		out := ""
		for i, p := range parts {
			if i > 0 {
				out += " > "
			}
			out += p
		}
		return out
	}
	// Path match first (old findExistingGenreByPathOrName).
	for _, g := range all {
		if pathOf(g) == trimmed {
			return g.id, g.name, nil
		}
	}
	var id, name string
	err = s.db.QueryRowContext(ctx,
		`SELECT id, name FROM genres WHERE name = ? LIMIT 1`, trimmed).Scan(&id, &name)
	if err == nil {
		return id, name, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", "", fmt.Errorf("find genre: %w", err)
	}
	id = newID()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO genres (id, name, active) VALUES (?, ?, 1)`, id, trimmed); err != nil {
		return "", "", fmt.Errorf("create genre: %w", err)
	}
	return id, trimmed, nil
}

// setJunction rewrites one position-ordered junction table for an owner row
// (the album-side equivalent of library.setJunction).
func setJunction(ctx context.Context, db *sql.DB, table, owner, member, ownerID string, memberIDs []string) error {
	if _, err := db.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM %s WHERE %s = ?`, table, owner), ownerID); err != nil {
		return fmt.Errorf("clear %s: %w", table, err)
	}
	insert := fmt.Sprintf(`INSERT INTO %s (%s, %s, position) VALUES (?, ?, ?)`, table, owner, member)
	for position, memberID := range memberIDs {
		if _, err := db.ExecContext(ctx, insert, ownerID, memberID, position); err != nil {
			return fmt.Errorf("insert %s: %w", table, err)
		}
	}
	return nil
}

// statFile isolates os.Stat for tests.
var statFile = os.Stat
