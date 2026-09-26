package ingest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	dbpkg "github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// Strategy is the old DuplicateStrategy (packages/shared duplicate.ts).
type Strategy string

const (
	// StrategyReplaceFileAndMetadata swaps in the new file and replaces the
	// metadata outright.
	StrategyReplaceFileAndMetadata Strategy = "replace_file_and_metadata"
	// StrategyKeepFileReplaceMetadata (the old DEFAULT) keeps the existing file
	// (its mtime/checksum stay on the row) and replaces the metadata.
	StrategyKeepFileReplaceMetadata Strategy = "keep_file_replace_metadata"
	// StrategyReplaceFileAggregateMetadata swaps in the new file and merges
	// metadata (artist/genre/composer junctions and producers/isrcs union).
	StrategyReplaceFileAggregateMetadata Strategy = "replace_file_aggregate_metadata"
	// StrategyKeepFileAggregateMetadata keeps the existing file and merges
	// metadata.
	StrategyKeepFileAggregateMetadata Strategy = "keep_file_aggregate_metadata"
	// StrategySkip deletes the incoming duplicate and changes nothing.
	StrategySkip Strategy = "skip"
)

// IsStrategy reports whether value is one of the five the retired server strategies.
func IsStrategy(value string) bool {
	switch Strategy(value) {
	case StrategyReplaceFileAndMetadata, StrategyKeepFileReplaceMetadata,
		StrategyReplaceFileAggregateMetadata, StrategyKeepFileAggregateMetadata,
		StrategySkip:
		return true
	}
	return false
}

// Resolution is the old DuplicateResolution: what the duplicate handler did.
type Resolution struct {
	ExistingID string
	FinalPath  string
	Skipped    bool
	Updated    bool
}

// identity is the old SongIdentity.
type identity struct {
	title       string
	albumID     *string
	artistIDs   []string
	trackNumber int
	discNumber  int
}

// existingSong is the matched row subset the retired server carried through its handlers.
type existingSong struct {
	id       string
	filePath string
	mtime    int64
	checksum string
	trackNo  *int
	discNo   *int
}

// HandleDuplicate ports the old handleDuplicateSong: resolve the incoming
// file's identity (title + album + artist set), find an active song with
// the same identity in the target library, and apply the strategy. It
// returns (nil, nil) when the file is not a duplicate — the caller proceeds
// with a normal import.
func HandleDuplicate(ctx context.Context, db *sql.DB, sourcePath, targetPath string, meta *audio.Metadata, mtime int64, checksum string, libraryID *string, strategy Strategy) (*Resolution, error) {
	ident, err := resolveSongIdentity(ctx, db, meta)
	if err != nil {
		return nil, err
	}
	if ident == nil {
		return nil, nil
	}
	existing, err := findExistingSongByIdentity(ctx, db, ident, libraryID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	switch strategy {
	case StrategyReplaceFileAndMetadata:
		return replaceFileAndMetadata(ctx, db, sourcePath, targetPath, existing, meta, mtime, checksum, libraryID, false)
	case StrategyKeepFileReplaceMetadata:
		return keepFileReplaceMetadata(ctx, db, sourcePath, existing, meta, libraryID, false)
	case StrategyReplaceFileAggregateMetadata:
		return replaceFileAndMetadata(ctx, db, sourcePath, targetPath, existing, meta, mtime, checksum, libraryID, true)
	case StrategyKeepFileAggregateMetadata:
		return keepFileReplaceMetadata(ctx, db, sourcePath, existing, meta, libraryID, true)
	case StrategySkip:
		return skipDuplicate(sourcePath, existing), nil
	default:
		return nil, nil
	}
}

// resolveSongIdentity ports the old resolveSongIdentity: trim the title, ensure
// the song and album artists exist (the old ensureArtist side effect — the
// rows are shared with the persist that follows), then resolve the album by
// (name, primary album artist) so compilations whose track artist differs
// still land on the correct album. Returns nil when the tags can't form an
// identity (missing title or artists).
func resolveSongIdentity(ctx context.Context, db *sql.DB, meta *audio.Metadata) (*identity, error) {
	title := strings.TrimSpace(meta.Title)
	if title == "" {
		return nil, nil
	}

	artistNames := meta.Artists
	if len(artistNames) == 0 && meta.Artist != "" {
		artistNames = []string{meta.Artist}
	}
	if len(artistNames) == 0 {
		return nil, nil
	}

	artistIDs := make([]string, 0, len(artistNames))
	for _, name := range artistNames {
		id, err := library.EnsureArtist(ctx, db, name, nil)
		if err != nil {
			return nil, err
		}
		artistIDs = append(artistIDs, id)
	}

	albumArtistNames := meta.AlbumArtists
	if len(albumArtistNames) == 0 && meta.AlbumArtist != "" {
		albumArtistNames = []string{meta.AlbumArtist}
	}
	if len(albumArtistNames) == 0 {
		albumArtistNames = artistNames
	}
	albumArtistIDs := make([]string, 0, len(albumArtistNames))
	for _, name := range albumArtistNames {
		id, err := library.EnsureArtist(ctx, db, name, nil)
		if err != nil {
			return nil, err
		}
		albumArtistIDs = append(albumArtistIDs, id)
	}

	var albumID *string
	if meta.Album != "" {
		id, err := findAlbumByNameAndArtist(ctx, db, meta.Album, albumArtistIDs[0])
		if err != nil {
			return nil, err
		}
		albumID = id
	}

	return &identity{
		title:       title,
		albumID:     albumID,
		artistIDs:   artistIDs,
		trackNumber: meta.TrackNo,
		discNumber:  meta.DiscNo,
	}, nil
}

// findAlbumByNameAndArtist ports the old getAlbumByNameAndArtist: case-
// insensitive name match with the primary album artist (or no artist).
func findAlbumByNameAndArtist(ctx context.Context, db *sql.DB, name, artistID string) (*string, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id FROM albums WHERE name = ? COLLATE NOCASE AND artist_id IS ?`,
		name, artistID)
	var id string
	err := row.Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load album %q: %w", name, err)
	}
	return &id, nil
}

// findExistingSongByIdentity ports the old findExistingSongByIdentity: active
// songs in the target library with a case-insensitive title match on the
// same album; the row with the identical artist SET wins, else the first
// track/disc fallback match.
func findExistingSongByIdentity(ctx context.Context, db *sql.DB, ident *identity, libraryID *string) (*existingSong, error) {
	query := `SELECT id, file_path, mtime, checksum, track_number, disc_number
		FROM songs
		WHERE active = 1
		  AND LOWER(title) = LOWER(?)
		  AND album_id IS ?`
	var albumArg any
	if ident.albumID != nil {
		albumArg = *ident.albumID
	}
	args := []any{ident.title, albumArg}
	if libraryID != nil {
		query += ` AND library_id = ?`
		args = append(args, *libraryID)
	}
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("find duplicate candidates: %w", err)
	}
	defer rows.Close()

	target := make(map[string]bool, len(ident.artistIDs))
	for _, id := range ident.artistIDs {
		target[id] = true
	}
	// Materialize the candidates BEFORE the per-row junction lookups: the
	// pool has a single connection, and querying under an open Rows would
	// deadlock on it.
	var candidates []existingSong
	for rows.Next() {
		var row existingSong
		var mtime dbpkg.Millis
		var trackNo, discNo dbpkg.NullInt64 // the retired server may have stored fractional REALs
		if err := rows.Scan(&row.id, &row.filePath, &mtime, &row.checksum, &trackNo, &discNo); err != nil {
			return nil, fmt.Errorf("find duplicate candidates: %w", err)
		}
		row.mtime = int64(mtime)
		if v, ok := trackNo.Value(); ok {
			t := int(v)
			row.trackNo = &t
		}
		if v, ok := discNo.Value(); ok {
			d := int(v)
			row.discNo = &d
		}
		candidates = append(candidates, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("find duplicate candidates: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("find duplicate candidates: %w", err)
	}

	var trackMatch *existingSong
	for i := range candidates {
		row := &candidates[i]
		existingIDs, err := songArtistIDs(ctx, db, row.id)
		if err != nil {
			return nil, err
		}
		if sameArtistSet(existingIDs, target) {
			return row, nil
		}
		if trackMatch == nil && ident.trackNumber != 0 &&
			row.trackNo != nil && *row.trackNo == ident.trackNumber &&
			(ident.discNumber == 0 || (row.discNo != nil && *row.discNo == ident.discNumber)) {
			trackMatch = row
		}
	}
	return trackMatch, nil
}

func songArtistIDs(ctx context.Context, db *sql.DB, songID string) ([]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT artist_id FROM song_artists WHERE song_id = ? ORDER BY position`, songID)
	if err != nil {
		return nil, fmt.Errorf("load song artists: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("load song artists: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load song artists: %w", err)
	}
	return ids, nil
}

func sameArtistSet(existing []string, target map[string]bool) bool {
	if len(existing) != len(target) {
		return false
	}
	for _, id := range existing {
		if !target[id] {
			return false
		}
	}
	return true
}

// skipDuplicate ports the old skipDuplicate: drop the incoming file, change
// nothing (cleanup failure is ignored — the sweep will see it again).
func skipDuplicate(sourcePath string, existing *existingSong) *Resolution {
	_ = os.Remove(sourcePath)
	return &Resolution{ExistingID: existing.id, Skipped: true}
}

// replaceFileAndMetadata ports the old replaceFileAndMetadata (aggregate
// selects the metadata merge mode). rename() silently overwrites an existing
// destination, so when the pattern target differs from the matched file's
// path and is already taken, a unique " (n)" target is chosen instead of
// destroying whatever occupies it (the old careful bit).
func replaceFileAndMetadata(ctx context.Context, db *sql.DB, sourcePath, targetPath string, existing *existingSong, meta *audio.Metadata, mtime int64, checksum string, libraryID *string, aggregate bool) (*Resolution, error) {
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return nil, err
	}

	finalPath := targetPath
	if targetPath != existing.filePath && fileExists(targetPath) {
		resolved, err := ResolveDuplicateTarget(targetPath)
		if err != nil {
			return nil, err
		}
		finalPath = resolved
	}

	if err := moveFile(sourcePath, finalPath); err != nil {
		return nil, err
	}

	if finalPath != existing.filePath {
		// The old file may already be gone or on a different device.
		_ = os.Remove(existing.filePath)
	}

	if _, err := library.PersistSong(ctx, db, library.PersistInput{
		ExistingID: &existing.id,
		Path:       finalPath,
		Meta:       meta,
		Mtime:      mtime,
		Checksum:   checksum,
		LibraryID:  libraryID,
		Merge:      library.PersistMerge{Aggregate: aggregate},
	}); err != nil {
		return nil, err
	}

	return &Resolution{ExistingID: existing.id, FinalPath: finalPath, Updated: true}, nil
}

// keepFileReplaceMetadata ports the old keepFileReplaceMetadata: the existing
// file stays on disk and its mtime/checksum stay on the row; only the
// metadata is rewritten (merge mode selects aggregate vs replace-present-
// only). The incoming file is deleted afterwards (cleanup failure is
// ignored, as the retired server).
func keepFileReplaceMetadata(ctx context.Context, db *sql.DB, sourcePath string, existing *existingSong, meta *audio.Metadata, libraryID *string, aggregate bool) (*Resolution, error) {
	if _, err := library.PersistSong(ctx, db, library.PersistInput{
		ExistingID: &existing.id,
		Path:       existing.filePath,
		Meta:       meta,
		Mtime:      existing.mtime,
		Checksum:   existing.checksum,
		LibraryID:  libraryID,
		Merge: library.PersistMerge{
			Aggregate:          aggregate,
			ReplacePresentOnly: !aggregate,
			KeepCoverArt:       true,
		},
	}); err != nil {
		return nil, err
	}

	_ = os.Remove(sourcePath)
	return &Resolution{ExistingID: existing.id, Updated: true}, nil
}
