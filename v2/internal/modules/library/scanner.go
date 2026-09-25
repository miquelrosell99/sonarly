// Scanner walks the configured library roots and reconciles the database
// with what is on disk: new files are imported, changed files re-imported,
// moved files detected by content hash, and vanished files deactivated
// (never deleted). It ports v1's features/library/scanner.ts with the audit's
// required fixes:
//
//   - persistSong runs in ONE transaction per song (v1 was multi-statement
//     autocommit; a crash mid-song could leave partial rows). A crash now
//     rolls back the whole song.
//   - average_rating is absent from the upsert column list entirely — the
//     v1 B4 bug clobbered user ratings on rescan because the upsert wrote
//     NULL over them (fixed on main; never ported).
//   - junction tables (song_artists/song_genres/song_composers) are rewritten
//     unconditionally in the same transaction, so tags that DROP an artist
//     actually drop the junction (v1 only rewrote when the new list was
//     non-empty, leaking stale rows).
//   - the walk is context-driven: cancellation stops it between songs, the
//     worker marks the job failed, and the in-flight per-song tx rolls back.
//
// One deliberate deviation: v1's syncSongCoverWithAlbum embedded the album
// cover INTO the audio file (tag rewrite). v2 is read-only during scans —
// the same reconciliation happens in the database (song cover link follows
// the album cover), and no audio file is ever mutated by a scan.
package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/v2/internal/audio"
)

// AUDIO_EXTS is the extension set v1 scanned.
var AUDIO_EXTS = map[string]bool{".mp3": true, ".flac": true, ".ogg": true, ".m4a": true}

// mediaTypes mirrors v1's mime-types lookup for the four audio extensions;
// a static map keeps the mapping deterministic regardless of the host's
// /etc/mime.types.
var mediaTypes = map[string]string{
	".mp3":  "audio/mpeg",
	".flac": "audio/flac",
	".ogg":  "audio/ogg",
	".m4a":  "audio/mp4",
}

// defaultOrganizePattern matches the libraries table default.
const defaultOrganizePattern = "{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}"

// maxScanFailures caps the per-file failure list v1 carried in stats; the
// failure count itself is not capped.
const maxScanFailures = 20

// progressEvery is how often (in processed files) the scanner reports live
// stats to the worker for the stats column.
const progressEvery = 25

// ErrLibraryNotFound is returned when a scan payload names a library id that
// no longer exists.
var ErrLibraryNotFound = errors.New("library not found")

// ScanFailure is one per-file error captured during a scan.
type ScanFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

// ScanStats is the job stats document (also the /api/scans/status payload).
type ScanStats struct {
	Scanned  int           `json:"scanned"`
	Added    int           `json:"added"`
	Updated  int           `json:"updated"`
	Removed  int           `json:"removed"`
	Moved    int           `json:"moved"`
	Failed   int           `json:"failed"`
	Failures []ScanFailure `json:"failures,omitempty"`
}

// Scanner reconciles library roots with the database.
type Scanner struct {
	db           *sql.DB
	log          *slog.Logger
	fallbackRoot string // config library path, used when no libraries row exists
}

func NewScanner(db *sql.DB, log *slog.Logger, fallbackRoot string) *Scanner {
	return &Scanner{db: db, log: log, fallbackRoot: fallbackRoot}
}

// EnsureDefaultLibrary creates the default libraries row from the configured
// library path when the table is empty — v1 parity (worker.ts boot).
func EnsureDefaultLibrary(ctx context.Context, db *sql.DB, path string) error {
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(1) FROM libraries`).Scan(&count); err != nil {
		return fmt.Errorf("count libraries: %w", err)
	}
	if count > 0 {
		return nil
	}
	name := path
	if idx := strings.LastIndex(strings.TrimRight(path, "/"), "/"); idx >= 0 {
		name = strings.TrimRight(path, "/")[idx+1:]
	}
	if name == "" {
		name = "Library"
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.ExecContext(ctx,
		`INSERT INTO libraries (id, name, path, created_at, updated_at, organize_pattern, is_default)
		 VALUES (?, ?, ?, ?, ?, ?, 1)`,
		uuid.NewString(), name, path, now, now, defaultOrganizePattern)
	if err != nil {
		return fmt.Errorf("create default library: %w", err)
	}
	return nil
}

// scanRoot is one library root to walk.
type scanRoot struct {
	libraryID string
	path      string
}

// scanRoots resolves which roots a scan job covers: the payload's library
// when set, otherwise every library (falling back to the configured library
// path when the table is empty, as v1 did).
func (s *Scanner) scanRoots(ctx context.Context, libraryID string) ([]scanRoot, error) {
	if libraryID != "" {
		var path string
		err := s.db.QueryRowContext(ctx, `SELECT path FROM libraries WHERE id = ?`, libraryID).Scan(&path)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrLibraryNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("load library %s: %w", libraryID, err)
		}
		return []scanRoot{{libraryID: libraryID, path: path}}, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, path FROM libraries ORDER BY path`)
	if err != nil {
		return nil, fmt.Errorf("list libraries: %w", err)
	}
	defer rows.Close()
	var roots []scanRoot
	for rows.Next() {
		var r scanRoot
		if err := rows.Scan(&r.libraryID, &r.path); err != nil {
			return nil, fmt.Errorf("list libraries: %w", err)
		}
		roots = append(roots, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list libraries: %w", err)
	}
	if len(roots) == 0 && s.fallbackRoot != "" {
		roots = append(roots, scanRoot{path: s.fallbackRoot})
	}
	return roots, nil
}

// Scan walks the roots for payload and reconciles the database. onProgress,
// when non-nil, receives the running stats every progressEvery files; it is
// called synchronously from the scanning goroutine.
//
// Cancellation: ctx is checked before every file and threaded into every
// transaction, so shutdown stops the walk between songs and rolls back the
// in-flight per-song tx. Cancellation surfaces as an error wrapping
// context.Canceled together with the partial stats.
func (s *Scanner) Scan(ctx context.Context, payload ScanPayload, onProgress func(*ScanStats)) (*ScanStats, error) {
	stats := &ScanStats{}
	roots, err := s.scanRoots(ctx, payload.LibraryID)
	if err != nil {
		return nil, err
	}

	foundPaths := map[string]struct{}{}
	movedFromPaths := map[string]struct{}{}
	var failedRoots []string
	var walkedRoots []scanRoot

	for _, root := range roots {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		// Probe the root BEFORE walking (and remember it for the
		// deactivation pass): an unmounted drive must not mass-deactivate
		// its songs — the v1 lesson the audit called out as done well.
		if _, err := os.ReadDir(root.path); err != nil {
			s.log.WarnContext(ctx, "scanner: library root unreadable, skipping",
				"root", root.path, "err", err)
			failedRoots = append(failedRoots, root.path)
			continue
		}
		walkedRoots = append(walkedRoots, root)

		if err := s.walkFiles(ctx, root.path, func(path string) error {
			return s.processFile(ctx, path, foundPaths, movedFromPaths, stats, onProgress)
		}); err != nil {
			return stats, err
		}
	}

	if err := s.deactivateMissing(ctx, foundPaths, movedFromPaths, failedRoots, walkedRoots, stats); err != nil {
		return stats, err
	}
	if err := s.recomputeActivity(ctx); err != nil {
		return stats, err
	}
	return stats, nil
}

// walkFiles recursively yields audio files under root, skipping dotfiles and
// dot-directories (including crashed atomic-tag-rewrite leftovers such as
// .sonarly-tmp-*). Unreadable subdirectories are logged and skipped, as v1.
func (s *Scanner) walkFiles(ctx context.Context, root string, visit func(path string) error) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		s.log.WarnContext(ctx, "scanner: cannot read directory, skipping", "dir", root, "err", err)
		return nil
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		full := filepath.Join(root, entry.Name())
		if entry.IsDir() {
			if err := s.walkFiles(ctx, full, visit); err != nil {
				return err
			}
			continue
		}
		if !AUDIO_EXTS[strings.ToLower(filepath.Ext(entry.Name()))] {
			continue
		}
		if err := visit(full); err != nil {
			return err
		}
	}
	return nil
}

// processFile imports or updates one audio file. Per-file errors are
// isolated: they increment Failed and (below the cap) land in Failures, and
// the walk continues. Context cancellation is NOT swallowed — it aborts the
// walk so the worker can fail the job.
func (s *Scanner) processFile(ctx context.Context, path string, foundPaths, movedFromPaths map[string]struct{}, stats *ScanStats, onProgress func(*ScanStats)) error {
	stats.Scanned++
	foundPaths[path] = struct{}{}
	if err := ctx.Err(); err != nil {
		return err
	}

	err := s.processFileInner(ctx, path, foundPaths, movedFromPaths, stats)
	if err == nil {
		if onProgress != nil && stats.Scanned%progressEvery == 0 {
			onProgress(stats)
		}
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	stats.Failed++
	if len(stats.Failures) < maxScanFailures {
		stats.Failures = append(stats.Failures, ScanFailure{Path: path, Error: err.Error()})
	}
	s.log.WarnContext(ctx, "scanner: failed to import file", "path", path, "err", err)
	return nil
}

func (s *Scanner) processFileInner(ctx context.Context, path string, foundPaths, movedFromPaths map[string]struct{}, stats *ScanStats) error {
	existing, err := songByPath(ctx, s.db, path)
	if err != nil {
		return err
	}

	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	mtime := info.ModTime().UnixMilli()
	unchanged := existing != nil && existing.active && existing.mtime == mtime
	needsCover := false
	if unchanged {
		needsCover, err = needsCoverSync(ctx, s.db, existing)
		if err != nil {
			return err
		}
	}
	if unchanged && !needsCover {
		return nil // v1 fast path: mtime unchanged and no cover link to fix
	}

	meta, err := audio.ReadMetadata(path)
	if err != nil {
		return fmt.Errorf("read metadata: %w", err)
	}

	if unchanged && needsCover {
		// File untouched; only reconcile cover-art links in the database.
		if err := s.persistCoverOnly(ctx, path, meta, existing); err != nil {
			return err
		}
		stats.Updated++
		return nil
	}

	checksum, err := checksumFile(path)
	if err != nil {
		return err
	}
	libraryID, err := resolveLibraryID(ctx, s.db, path)
	if err != nil {
		return err
	}

	switch {
	case existing == nil:
		// Move detection before import: a new path whose content hash
		// matches a known row whose old path is gone means the file was
		// moved, not copied — update the path, keep the row (and its user
		// data). Replaced-file detection reuses an inactive row with
		// matching title/album/artist for the same reason.
		target, err := s.findMoveTarget(ctx, checksum, foundPaths, meta)
		if err != nil {
			return err
		}
		if target != nil {
			if err := s.persistSong(ctx, path, meta, mtime, checksum, libraryID, target); err != nil {
				return err
			}
			movedFromPaths[target.filePath] = struct{}{}
			stats.Moved++
			return nil
		}
		if err := s.persistSong(ctx, path, meta, mtime, checksum, libraryID, nil); err != nil {
			return err
		}
		stats.Added++
		return nil
	default:
		if err := s.persistSong(ctx, path, meta, mtime, checksum, libraryID, existing); err != nil {
			return err
		}
		stats.Updated++
		return nil
	}
}

// findMoveTarget locates the row a new file at path was moved FROM (checksum
// match whose old path has not been seen this scan), or an inactive row with
// matching title/album/artist (file replaced in place). Returns nil for a
// genuinely new file.
func (s *Scanner) findMoveTarget(ctx context.Context, checksum string, foundPaths map[string]struct{}, meta *audio.Metadata) (*songRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, file_path, cover_art_id FROM songs WHERE checksum = ? ORDER BY rowid`, checksum)
	if err != nil {
		return nil, fmt.Errorf("find moved song: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var r songRow
		if err := rows.Scan(&r.id, &r.filePath, &r.coverArtID); err != nil {
			return nil, fmt.Errorf("find moved song: %w", err)
		}
		if _, seen := foundPaths[r.filePath]; !seen {
			return &r, nil
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("find moved song: %w", err)
	}

	if meta.Title == "" {
		return nil, nil
	}
	var albumID, artistID *string
	if meta.Album != "" {
		albumID = new(string)
		_ = s.db.QueryRowContext(ctx,
			`SELECT id FROM albums WHERE name = ? COLLATE NOCASE`, strings.TrimSpace(meta.Album)).Scan(albumID)
	}
	artistName := firstOf(meta.Artists, meta.AlbumArtist)
	if artistName != "" {
		artistID = new(string)
		_ = s.db.QueryRowContext(ctx,
			`SELECT id FROM artists WHERE name = ? COLLATE NOCASE`, strings.TrimSpace(artistName)).Scan(artistID)
	}
	row := s.db.QueryRowContext(ctx,
		`SELECT id, file_path, cover_art_id FROM songs
		 WHERE active = 0 AND LOWER(title) = LOWER(?)
		   AND (album_id IS ? OR album_id = ?)
		   AND (artist_id IS ? OR artist_id = ?)
		 LIMIT 1`,
		meta.Title,
		val(albumID), val(albumID),
		val(artistID), val(artistID))
	var r songRow
	if err := row.Scan(&r.id, &r.filePath, &r.coverArtID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("find replaced song: %w", err)
	}
	return &r, nil
}

// deactivateMissing marks DB rows under walked roots as inactive when their
// file was not seen this scan. Deactivation (not deletion) is deliberate:
// user data (ratings, history) survives and a file that reappears reuses its
// row. Paths under a failed root are protected (the v1 unmounted-drive
// lesson), and paths under no walked root are left alone — a library-scoped
// scan must not touch other libraries' rows.
func (s *Scanner) deactivateMissing(ctx context.Context, foundPaths, movedFromPaths map[string]struct{}, failedRoots []string, walkedRoots []scanRoot, stats *ScanStats) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id, file_path FROM songs WHERE active = 1`)
	if err != nil {
		return fmt.Errorf("list active songs: %w", err)
	}
	defer rows.Close()

	var toDeactivate []string
	for rows.Next() {
		var id, path string
		if err := rows.Scan(&id, &path); err != nil {
			return fmt.Errorf("list active songs: %w", err)
		}
		if _, ok := foundPaths[path]; ok {
			continue
		}
		if _, ok := movedFromPaths[path]; ok {
			continue
		}
		if anyRootContains(failedRoots, path) {
			continue
		}
		if !anyRootContains(rootPaths(walkedRoots), path) {
			continue
		}
		toDeactivate = append(toDeactivate, id)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list active songs: %w", err)
	}
	if len(toDeactivate) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin deactivation tx: %w", err)
	}
	stmt, err := tx.PrepareContext(ctx, `UPDATE songs SET active = 0 WHERE id = ?`)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("prepare deactivation: %w", err)
	}
	defer stmt.Close()
	for _, id := range toDeactivate {
		if _, err := stmt.ExecContext(ctx, id); err != nil {
			tx.Rollback()
			return fmt.Errorf("deactivate song %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit deactivation tx: %w", err)
	}
	stats.Removed += len(toDeactivate)
	return nil
}

// recomputeActivity ports v1's end-of-scan pass: album/artist/label active
// flags reflect whether any reachable (active) song still references them.
func (s *Scanner) recomputeActivity(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin activity tx: %w", err)
	}
	stmts := []string{
		`UPDATE albums
		 SET active = CASE
		   WHEN id IN (SELECT DISTINCT album_id FROM songs WHERE active = 1 AND album_id IS NOT NULL) THEN 1
		   ELSE 0
		 END`,
		`UPDATE artists
		 SET active = CASE
		   WHEN id IN (SELECT DISTINCT artist_id FROM songs WHERE active = 1 AND artist_id IS NOT NULL) THEN 1
		   WHEN id IN (SELECT DISTINCT artist_id FROM albums WHERE active = 1 AND artist_id IS NOT NULL) THEN 1
		   WHEN id IN (SELECT DISTINCT sa.artist_id FROM song_artists sa JOIN songs s ON s.id = sa.song_id WHERE s.active = 1) THEN 1
		   WHEN id IN (SELECT DISTINCT aa.artist_id FROM album_artists aa JOIN albums a ON a.id = aa.album_id WHERE a.active = 1) THEN 1
		   WHEN id IN (SELECT DISTINCT sc.artist_id FROM song_composers sc JOIN songs s ON s.id = sc.song_id WHERE s.active = 1) THEN 1
		   ELSE 0
		 END`,
		`UPDATE labels
		 SET active = CASE
		   WHEN id IN (SELECT DISTINCT al.label_id FROM album_labels al JOIN albums a ON a.id = al.album_id WHERE a.active = 1) THEN 1
		   ELSE 0
		 END`,
	}
	for _, q := range stmts {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			tx.Rollback()
			return fmt.Errorf("recompute activity: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit activity tx: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Per-song transactional persist
// ---------------------------------------------------------------------------

// execer abstracts *sql.DB and *sql.Tx so the ensure-* helpers run inside
// the per-song transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type albumMeta struct {
	barcode          string
	asin             string
	mbAlbumID        string
	mbReleaseGroupID string
	mbAlbumArtistIDs []string
	compilation      *bool
	releaseType      string
	totalTracks      int
	totalDiscs       int
}

// persistSong writes one song and everything it references in a single
// transaction: artists/genres/labels get-or-create, the album row and its
// junctions, the song upsert (average_rating excluded — see package doc),
// junction rewrites, and cover-art hash dedup + links. existing may be nil
// (new import), the row being re-scanned, or the move/replace target row.
func (s *Scanner) persistSong(ctx context.Context, path string, meta *audio.Metadata, mtime int64, checksum string, libraryID *string, existing *songRow) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin song tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			tx.Rollback()
		}
	}()

	// Song artists, with per-index MusicBrainz ids (v1 parity).
	artistNames := artistNames(meta)
	var artistIDs []string
	for i, name := range artistNames {
		var mbids []string
		if i < len(meta.MBIDArtistIDs) && meta.MBIDArtistIDs[i] != "" {
			mbids = []string{meta.MBIDArtistIDs[i]}
		}
		id, err := ensureArtist(ctx, tx, name, mbids)
		if err != nil {
			return err
		}
		artistIDs = append(artistIDs, id)
	}
	var primaryArtistID *string
	if len(artistIDs) > 0 {
		primaryArtistID = &artistIDs[0]
	}

	albumArtistNames := albumArtistNames(meta, artistNames)
	var albumArtistIDs []string
	for _, name := range albumArtistNames {
		id, err := ensureArtist(ctx, tx, name, nil)
		if err != nil {
			return err
		}
		albumArtistIDs = append(albumArtistIDs, id)
	}

	var composerIDs []string
	for _, name := range meta.Composers {
		id, err := ensureArtist(ctx, tx, name, nil)
		if err != nil {
			return err
		}
		composerIDs = append(composerIDs, id)
	}

	var genreIDs []string
	for _, name := range meta.Genres {
		id, err := ensureGenre(ctx, tx, name)
		if err != nil {
			return err
		}
		genreIDs = append(genreIDs, id)
	}

	var albumID *string
	if trimmed := strings.TrimSpace(meta.Album); trimmed != "" {
		am := albumMeta{
			barcode:          meta.Barcode,
			asin:             meta.ASIN,
			mbAlbumID:        meta.MBIDRelease,
			mbReleaseGroupID: meta.MBIDReleaseGroup,
			compilation:      meta.Compilation,
			releaseType:      normalizeReleaseType(meta.ReleaseType),
			totalTracks:      meta.TrackTotal,
			totalDiscs:       meta.DiscTotal,
		}
		if meta.MBIDAlbumArtist != "" {
			am.mbAlbumArtistIDs = []string{meta.MBIDAlbumArtist}
		}
		id, err := ensureAlbum(ctx, tx, trimmed, albumArtistNames, albumArtistIDs, meta.Year, meta.Genres, genreIDs, meta.Labels, am)
		if err != nil {
			return err
		}
		albumID = &id
	}

	// Cover art: hash-dedup blob, album seeded from the first song carrying
	// embedded art (v1 behavior), song link follows the album cover.
	var ownCoverID *string
	if meta.HasCoverArt && meta.Picture != nil {
		id, err := ensureCoverArt(ctx, tx, meta.Picture)
		if err != nil {
			return err
		}
		ownCoverID = &id
		if albumID != nil {
			albumCover, err := albumCoverArtID(ctx, tx, *albumID)
			if err != nil {
				return err
			}
			if albumCover == nil {
				if err := setAlbumCoverArtID(ctx, tx, *albumID, ownCoverID); err != nil {
					return err
				}
			}
		}
	}

	var songCoverID *string
	if existing != nil {
		songCoverID = existing.coverArtID
	}
	if albumID != nil {
		albumCover, err := albumCoverArtID(ctx, tx, *albumID)
		if err != nil {
			return err
		}
		if albumCover != nil && (songCoverID == nil || *songCoverID != *albumCover) {
			// v1 wrote the album cover into the file and pointed the row at
			// it; v2 reconciles the link only (read-only scans).
			songCoverID = albumCover
		}
	}
	if songCoverID == nil {
		songCoverID = ownCoverID
	}

	songID := uuid.NewString()
	if existing != nil {
		songID = existing.id
	}
	song := songData{
		id:                 songID,
		filePath:           path,
		title:              meta.Title,
		trackNo:            zeroNil(meta.TrackNo),
		discNo:             zeroNil(meta.DiscNo),
		duration:           zeroNil(int(math.Round(meta.Properties.Duration))),
		artistID:           primaryArtistID,
		albumID:            albumID,
		genre:              firstNil(meta.Genres),
		genreID:            firstPtr(genreIDs),
		libraryID:          libraryID,
		year:               zeroNil(meta.Year),
		explicit:           meta.Explicit != nil && *meta.Explicit,
		coverArtID:         songCoverID,
		coverArtMissing:    !meta.HasCoverArt,
		mtime:              mtime,
		checksum:           checksum,
		bitRate:            zeroNil(meta.Properties.Bitrate),
		bitsPerSample:      zeroNil(meta.Properties.BitsPerSample),
		sampleRate:         zeroNil(meta.Properties.SampleRate),
		channels:           zeroNil(meta.Properties.Channels),
		bpm:                zeroNil(meta.BPM),
		mbid:               emptyNil(meta.MBIDRecording),
		replayGain:         zeroNilF(meta.ReplayGainTrack),
		comment:            emptyNil(meta.Comment),
		mediaType:          mediaTypeFor(path),
		lyrics:             emptyNil(meta.Lyrics),
		syncedLyrics:       marshalNil(meta.SyncedLyrics),
		producers:          marshalNil(meta.Producers),
		isrcs:              marshalNil(meta.ISRCs),
		displayArtist:      emptyNil(meta.Artist),
		displayAlbumArtist: emptyNil(firstOf(meta.AlbumArtists, meta.AlbumArtist)),
		totalTracks:        countText(meta.TrackTotal),
		totalDiscs:         countText(meta.DiscTotal),
	}
	if err := upsertSong(ctx, tx, song); err != nil {
		return err
	}

	// Junction rewrites: unconditional (delete + reinsert) so removed tags
	// actually remove rows — all inside the song's tx.
	if err := setJunction(ctx, tx, "song_artists", "song_id", "artist_id", songID, artistIDs); err != nil {
		return err
	}
	if err := setJunction(ctx, tx, "song_genres", "song_id", "genre_id", songID, genreIDs); err != nil {
		return err
	}
	if err := setJunction(ctx, tx, "song_composers", "song_id", "artist_id", songID, composerIDs); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit song tx: %w", err)
	}
	committed = true
	return nil
}

// persistCoverOnly reconciles cover-art links for a file whose mtime is
// unchanged (v1's needsCoverSync path) without re-importing it.
func (s *Scanner) persistCoverOnly(ctx context.Context, path string, meta *audio.Metadata, existing *songRow) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin cover tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			tx.Rollback()
		}
	}()

	artistNames := artistNames(meta)
	albumArtistNames := albumArtistNames(meta, artistNames)
	var genreIDs []string
	for _, name := range meta.Genres {
		id, err := ensureGenre(ctx, tx, name)
		if err != nil {
			return err
		}
		genreIDs = append(genreIDs, id)
	}
	var albumArtistIDs []string
	for _, name := range albumArtistNames {
		id, err := ensureArtist(ctx, tx, name, nil)
		if err != nil {
			return err
		}
		albumArtistIDs = append(albumArtistIDs, id)
	}

	var albumID *string
	if trimmed := strings.TrimSpace(meta.Album); trimmed != "" {
		id, err := ensureAlbum(ctx, tx, trimmed, albumArtistNames, albumArtistIDs, meta.Year, meta.Genres, genreIDs, meta.Labels, albumMeta{})
		if err != nil {
			return err
		}
		albumID = &id
	}

	if meta.HasCoverArt && meta.Picture != nil && albumID != nil {
		albumCover, err := albumCoverArtID(ctx, tx, *albumID)
		if err != nil {
			return err
		}
		if albumCover == nil {
			ownCoverID, err := ensureCoverArt(ctx, tx, meta.Picture)
			if err != nil {
				return err
			}
			if err := setAlbumCoverArtID(ctx, tx, *albumID, &ownCoverID); err != nil {
				return err
			}
		}
	}

	coverMissing := 0
	if !meta.HasCoverArt {
		coverMissing = 1
	}
	var libraryID any
	if existing.libraryID != nil {
		libraryID = *existing.libraryID
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE songs SET cover_art_missing = ?, library_id = ? WHERE id = ?`,
		coverMissing, libraryID, existing.id); err != nil {
		return fmt.Errorf("update cover flags: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit cover tx: %w", err)
	}
	committed = true
	return nil
}

// ---------------------------------------------------------------------------
// Row helpers (all run on the given execer — inside the song tx when called
// from persist)
// ---------------------------------------------------------------------------

type songRow struct {
	id              string
	filePath        string
	mtime           int64
	active          bool
	albumID         *string
	coverArtID      *string
	coverArtMissing bool
	libraryID       *string
}

func songByPath(ctx context.Context, db *sql.DB, path string) (*songRow, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id, file_path, mtime, active, album_id, cover_art_id, cover_art_missing, library_id
		 FROM songs WHERE file_path = ?`, path)
	var r songRow
	var active, missing int
	if err := row.Scan(&r.id, &r.filePath, &r.mtime, &active, &r.albumID, &r.coverArtID, &missing, &r.libraryID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load song by path: %w", err)
	}
	r.active = active == 1
	r.coverArtMissing = missing == 1
	return &r, nil
}

// needsCoverSync reports whether an unchanged file still owes a cover-art
// link reconciliation: its album has a different cover than the song, or the
// album has none and this song was not yet confirmed coverless.
func needsCoverSync(ctx context.Context, db *sql.DB, s *songRow) (bool, error) {
	if s.albumID == nil {
		return false, nil
	}
	var albumCover *string
	err := db.QueryRowContext(ctx, `SELECT cover_art_id FROM albums WHERE id = ?`, *s.albumID).Scan(&albumCover)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load album cover: %w", err)
	}
	if albumCover != nil {
		return s.coverArtID == nil || *s.coverArtID != *albumCover, nil
	}
	return !s.coverArtMissing, nil
}

func ensureArtist(ctx context.Context, ex execer, name string, mbids []string) (string, error) {
	trimmed := strings.TrimSpace(name)
	var id, existingMB string
	err := ex.QueryRowContext(ctx,
		`SELECT id, COALESCE(musicbrainz_artist_ids, '') FROM artists WHERE name = ? COLLATE NOCASE`,
		trimmed).Scan(&id, &existingMB)
	if err == nil {
		if len(mbids) > 0 {
			merged, changed, err := mergeMBIDs(existingMB, mbids)
			if err != nil {
				return "", fmt.Errorf("merge artist mbids: %w", err)
			}
			if changed {
				if _, err := ex.ExecContext(ctx,
					`UPDATE artists SET musicbrainz_artist_ids = ? WHERE id = ?`, merged, id); err != nil {
					return "", fmt.Errorf("update artist mbids: %w", err)
				}
			}
		}
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load artist: %w", err)
	}
	id = uuid.NewString()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO artists (id, name) VALUES (?, ?)`, id, trimmed); err != nil {
		return "", fmt.Errorf("insert artist: %w", err)
	}
	if len(mbids) > 0 {
		raw, _ := json.Marshal(mbids)
		if _, err := ex.ExecContext(ctx,
			`UPDATE artists SET musicbrainz_artist_ids = ? WHERE id = ?`, string(raw), id); err != nil {
			return "", fmt.Errorf("set artist mbids: %w", err)
		}
	}
	return id, nil
}

func ensureGenre(ctx context.Context, ex execer, name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", errors.New("genre name cannot be empty")
	}
	var id string
	err := ex.QueryRowContext(ctx,
		`SELECT id FROM genres WHERE name = ? COLLATE NOCASE`, trimmed).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load genre: %w", err)
	}
	id = uuid.NewString()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO genres (id, name) VALUES (?, ?)`, id, trimmed); err != nil {
		return "", fmt.Errorf("insert genre: %w", err)
	}
	return id, nil
}

func ensureLabel(ctx context.Context, ex execer, name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	var id string
	err := ex.QueryRowContext(ctx,
		`SELECT id FROM labels WHERE name = ? COLLATE NOCASE`, trimmed).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load label: %w", err)
	}
	id = uuid.NewString()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO labels (id, name) VALUES (?, ?)`, id, trimmed); err != nil {
		return "", fmt.Errorf("insert label: %w", err)
	}
	return id, nil
}

// ensureAlbum ports v1's ensureAlbum: match by (name, primary artist), fill
// junctions and release metadata on first create, only add multi-value
// junctions and never overwrite release_type on later songs. All in the
// caller's tx.
func ensureAlbum(ctx context.Context, ex execer, name string, artistNames []string, artistIDs []string, year int, genreNames []string, genreIDs []string, labelNames []string, meta albumMeta) (string, error) {
	var primaryArtistID *string
	if len(artistIDs) > 0 {
		primaryArtistID = &artistIDs[0]
	}
	var id string
	row := ex.QueryRowContext(ctx,
		`SELECT id FROM albums WHERE name = ? COLLATE NOCASE AND artist_id IS ?`,
		name, primaryArtistID)
	err := row.Scan(&id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load album: %w", err)
	}
	if err == nil {
		if len(artistIDs) > 1 {
			if err := setJunction(ctx, ex, "album_artists", "album_id", "artist_id", id, artistIDs); err != nil {
				return "", err
			}
		}
		if len(genreIDs) > 1 {
			if err := setJunction(ctx, ex, "album_genres", "album_id", "genre_id", id, genreIDs); err != nil {
				return "", err
			}
		}
		if len(labelNames) > 0 {
			labelIDs, err := ensureLabels(ctx, ex, labelNames)
			if err != nil {
				return "", err
			}
			if err := setJunction(ctx, ex, "album_labels", "album_id", "label_id", id, labelIDs); err != nil {
				return "", err
			}
		}
		if meta.releaseType != "" {
			// Fill in from tags but never overwrite a user edit.
			if _, err := ex.ExecContext(ctx,
				`UPDATE albums SET release_type = ? WHERE id = ? AND release_type IS NULL`,
				meta.releaseType, id); err != nil {
				return "", fmt.Errorf("fill album release type: %w", err)
			}
		}
		return id, nil
	}

	id = uuid.NewString()
	var yearV any
	if year != 0 {
		yearV = year
	}
	var genreV any
	if len(genreNames) > 0 {
		genreV = genreNames[0]
	}
	var genreIDV any
	if len(genreIDs) > 0 {
		genreIDV = genreIDs[0]
	}
	var artistNameV any
	if len(artistNames) > 0 {
		artistNameV = strings.Join(artistNames, " / ")
	}
	var compilationV any
	if meta.compilation != nil {
		compilationV = 0
		if *meta.compilation {
			compilationV = 1
		}
	}
	_, err = ex.ExecContext(ctx,
		`INSERT INTO albums (id, name, artist_id, artist_name, year, genre, genre_id, active,
			barcode, asin, musicbrainz_album_id, musicbrainz_release_group_id, musicbrainz_album_artist_ids,
			compilation, total_tracks, total_discs, release_type)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, name, val(primaryArtistID), artistNameV, yearV, genreV, genreIDV,
		emptyNil(meta.barcode), emptyNil(meta.asin),
		emptyNil(meta.mbAlbumID), emptyNil(meta.mbReleaseGroupID), marshalNil(meta.mbAlbumArtistIDs),
		compilationV, countText(meta.totalTracks), countText(meta.totalDiscs), emptyNil(meta.releaseType))
	if err != nil {
		return "", fmt.Errorf("insert album: %w", err)
	}
	if len(artistIDs) > 0 {
		if err := setJunction(ctx, ex, "album_artists", "album_id", "artist_id", id, artistIDs); err != nil {
			return "", err
		}
	}
	if len(genreIDs) > 0 {
		if err := setJunction(ctx, ex, "album_genres", "album_id", "genre_id", id, genreIDs); err != nil {
			return "", err
		}
	}
	if len(labelNames) > 0 {
		labelIDs, err := ensureLabels(ctx, ex, labelNames)
		if err != nil {
			return "", err
		}
		if err := setJunction(ctx, ex, "album_labels", "album_id", "label_id", id, labelIDs); err != nil {
			return "", err
		}
	}
	return id, nil
}

func ensureLabels(ctx context.Context, ex execer, names []string) ([]string, error) {
	ids := make([]string, 0, len(names))
	for _, name := range names {
		id, err := ensureLabel(ctx, ex, name)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// setJunction deletes and reinserts a junction table's rows for one owner,
// preserving position order. table/owner/member are hardcoded identifiers at
// call sites; only values are bound.
func setJunction(ctx context.Context, ex execer, table, owner, member, ownerID string, memberIDs []string) error {
	if _, err := ex.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM %s WHERE %s = ?`, table, owner), ownerID); err != nil {
		return fmt.Errorf("clear %s: %w", table, err)
	}
	if len(memberIDs) == 0 {
		return nil
	}
	insert := fmt.Sprintf(`INSERT INTO %s (%s, %s, position) VALUES (?, ?, ?)`, table, owner, member)
	for position, memberID := range memberIDs {
		if _, err := ex.ExecContext(ctx, insert, ownerID, memberID, position); err != nil {
			return fmt.Errorf("insert %s: %w", table, err)
		}
	}
	return nil
}

// ensureCoverArt returns the id of the blob with this content (sha256
// hash-dedup, v1 createCoverArt), inserting it on first sight.
func ensureCoverArt(ctx context.Context, ex execer, pic *audio.Picture) (string, error) {
	sum := sha256.Sum256(pic.Data)
	hash := hex.EncodeToString(sum[:])
	var id string
	err := ex.QueryRowContext(ctx, `SELECT id FROM cover_arts WHERE hash = ?`, hash).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load cover art: %w", err)
	}
	id = uuid.NewString()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO cover_arts (id, format, data, hash) VALUES (?, ?, ?, ?)`,
		id, pic.MIMEType, pic.Data, hash); err != nil {
		return "", fmt.Errorf("insert cover art: %w", err)
	}
	return id, nil
}

func albumCoverArtID(ctx context.Context, ex execer, albumID string) (*string, error) {
	var id *string
	if err := ex.QueryRowContext(ctx,
		`SELECT cover_art_id FROM albums WHERE id = ?`, albumID).Scan(&id); err != nil {
		return nil, fmt.Errorf("load album cover: %w", err)
	}
	return id, nil
}

func setAlbumCoverArtID(ctx context.Context, ex execer, albumID string, coverID *string) error {
	var v any
	if coverID != nil {
		v = *coverID
	}
	if _, err := ex.ExecContext(ctx,
		`UPDATE albums SET cover_art_id = ? WHERE id = ?`, v, albumID); err != nil {
		return fmt.Errorf("set album cover: %w", err)
	}
	return nil
}

// songData carries the columns the scanner writes. Columns the v2 metadata
// reader does not extract (sort_name, mood, the date/remix/original* family,
// track/work/disc MBIDs) stay NULL — the upsert below never touches them.
// average_rating is deliberately absent: user ratings must survive rescans.
type songData struct {
	id                 string
	filePath           string
	title              string
	trackNo            *int
	discNo             *int
	duration           *int
	artistID           *string
	albumID            *string
	genre              *string
	genreID            *string
	libraryID          *string
	year               *int
	explicit           bool
	coverArtID         *string
	coverArtMissing    bool
	mtime              int64
	checksum           string
	bitRate            *int
	bitsPerSample      *int
	sampleRate         *int
	channels           *int
	bpm                *int
	mbid               *string
	replayGain         *float64
	comment            *string
	mediaType          *string
	lyrics             *string
	syncedLyrics       *string
	producers          *string
	isrcs              *string
	displayArtist      *string
	displayAlbumArtist *string
	totalTracks        *string
	totalDiscs         *string
}

// upsertSong inserts or replaces a song row by id. The column list excludes
// average_rating entirely so a rescan can never reset user ratings (v1 B4).
func upsertSong(ctx context.Context, ex execer, s songData) error {
	explicit := 0
	if s.explicit {
		explicit = 1
	}
	coverMissing := 0
	if s.coverArtMissing {
		coverMissing = 1
	}
	columns := `id, file_path, title, track_number, disc_number, duration, artist_id, album_id,
		genre, genre_id, library_id, year, explicit, cover_art_id, cover_art_missing, mtime, checksum, active,
		bit_rate, bits_per_sample, sample_rate, channels, bpm, music_brainz_id, replay_gain,
		comment, media_type, lyrics, synced_lyrics, producers, isrcs,
		display_artist, display_album_artist, total_tracks, total_discs`
	values := `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`
	assignments := `file_path = excluded.file_path, title = excluded.title,
		track_number = excluded.track_number, disc_number = excluded.disc_number, duration = excluded.duration,
		artist_id = excluded.artist_id, album_id = excluded.album_id, genre = excluded.genre, genre_id = excluded.genre_id,
		library_id = excluded.library_id, year = excluded.year, explicit = excluded.explicit,
		cover_art_id = excluded.cover_art_id, cover_art_missing = excluded.cover_art_missing,
		mtime = excluded.mtime, checksum = excluded.checksum, active = 1,
		bit_rate = excluded.bit_rate, bits_per_sample = excluded.bits_per_sample, sample_rate = excluded.sample_rate,
		channels = excluded.channels, bpm = excluded.bpm, music_brainz_id = excluded.music_brainz_id,
		replay_gain = excluded.replay_gain, comment = excluded.comment, media_type = excluded.media_type,
		lyrics = excluded.lyrics, synced_lyrics = excluded.synced_lyrics, producers = excluded.producers,
		isrcs = excluded.isrcs, display_artist = excluded.display_artist, display_album_artist = excluded.display_album_artist,
		total_tracks = excluded.total_tracks, total_discs = excluded.total_discs`
	query := fmt.Sprintf(`INSERT INTO songs (%s) VALUES (%s)
		ON CONFLICT(id) DO UPDATE SET %s`, columns, values, assignments)
	_, err := ex.ExecContext(ctx, query,
		s.id, s.filePath, s.title, val(s.trackNo), val(s.discNo), val(s.duration), val(s.artistID), val(s.albumID),
		val(s.genre), val(s.genreID), val(s.libraryID), val(s.year), explicit, val(s.coverArtID), coverMissing, s.mtime, s.checksum,
		val(s.bitRate), val(s.bitsPerSample), val(s.sampleRate), val(s.channels), val(s.bpm), val(s.mbid), val(s.replayGain),
		val(s.comment), val(s.mediaType), val(s.lyrics), val(s.syncedLyrics), val(s.producers), val(s.isrcs),
		val(s.displayArtist), val(s.displayAlbumArtist), val(s.totalTracks), val(s.totalDiscs))
	if err != nil {
		return fmt.Errorf("upsert song: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

func resolveLibraryID(ctx context.Context, db *sql.DB, path string) (*string, error) {
	// Exact path or prefix at a separator boundary so /music does not
	// claim /music2 (v1 parity).
	var id string
	err := db.QueryRowContext(ctx,
		`SELECT id FROM libraries
		 WHERE ? = path OR ? LIKE path || '/%'
		 ORDER BY length(path) DESC LIMIT 1`, path, path).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("resolve library: %w", err)
	}
	return &id, nil
}

// checksumFile streams the file through SHA-256 (v1 computeChecksum).
func checksumFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// artistNames mirrors v1: multi-value split artists, falling back to the
// single display artist string.
func artistNames(meta *audio.Metadata) []string {
	if len(meta.Artists) > 0 {
		return meta.Artists
	}
	if meta.Artist != "" {
		return []string{meta.Artist}
	}
	return nil
}

func albumArtistNames(meta *audio.Metadata, songArtists []string) []string {
	if len(meta.AlbumArtists) > 0 {
		return meta.AlbumArtists
	}
	if meta.AlbumArtist != "" {
		return []string{meta.AlbumArtist}
	}
	return songArtists
}

func normalizeReleaseType(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	return trimmed
}

func mediaTypeFor(path string) *string {
	mt, ok := mediaTypes[strings.ToLower(filepath.Ext(path))]
	if !ok {
		return nil
	}
	return &mt
}

func rootPaths(roots []scanRoot) []string {
	paths := make([]string, 0, len(roots))
	for _, r := range roots {
		paths = append(paths, r.path)
	}
	return paths
}

func anyRootContains(roots []string, path string) bool {
	for _, root := range roots {
		if pathWithinRoot(path, root) {
			return true
		}
	}
	return false
}

func pathWithinRoot(path, root string) bool {
	normalized := strings.TrimRight(root, string(os.PathSeparator))
	return path == normalized || strings.HasPrefix(path, normalized+string(os.PathSeparator))
}

func zeroNil(v int) *int {
	if v == 0 {
		return nil
	}
	return &v
}

func zeroNilF(v float64) *float64 {
	if v == 0 {
		return nil
	}
	return &v
}

func emptyNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func firstNil(values []string) *string {
	for i, v := range values {
		if strings.TrimSpace(v) != "" {
			return &values[i]
		}
	}
	return nil
}

func firstPtr(ids []string) *string {
	if len(ids) == 0 {
		return nil
	}
	return &ids[0]
}

func firstOf(values []string, fallback ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	for _, v := range fallback {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func countText(v int) *string {
	if v <= 0 {
		return nil
	}
	s := strconv.Itoa(v)
	return &s
}

func marshalNil(v any) *string {
	switch values := v.(type) {
	case nil:
		return nil
	case []string:
		if len(values) == 0 {
			return nil
		}
	case []audio.SyncedLyricLine:
		if len(values) == 0 {
			return nil
		}
	}
	raw, err := json.Marshal(v)
	if err != nil || string(raw) == "null" {
		return nil
	}
	s := string(raw)
	return &s
}

// val converts a pointer into a driver value: nil for the zero pointer,
// the pointee otherwise. database/sql does not dereference pointer args.
func val[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// mergeMBIDs unions stored MusicBrainz ids with newly seen ones; the second
// return reports whether the stored set changed.
func mergeMBIDs(stored string, add []string) (string, bool, error) {
	seen := map[string]bool{}
	var merged []string
	if stored != "" {
		var existing []string
		if err := json.Unmarshal([]byte(stored), &existing); err != nil {
			return "", false, fmt.Errorf("parse artist mbids: %w", err)
		}
		for _, id := range existing {
			if !seen[id] {
				seen[id] = true
				merged = append(merged, id)
			}
		}
	}
	changed := false
	for _, id := range add {
		if !seen[id] {
			seen[id] = true
			merged = append(merged, id)
			changed = true
		}
	}
	if !changed {
		return stored, false, nil
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return "", false, err
	}
	return string(raw), true, nil
}
