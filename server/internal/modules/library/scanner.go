// Scanner walks the configured library roots and reconciles the database
// with what is on disk: new files are imported, changed files re-imported,
// moved files detected by content hash, and vanished files deactivated
// (never deleted). It ports v1's features/library/scanner.ts with the audit's
// required fixes:
//
//   - every song is written through PersistSong (persist.go) — ONE
//     transaction per song (v1 was multi-statement autocommit; a crash
//     mid-song could leave partial rows). A crash now rolls back the whole
//     song. The ingest pipeline writes through the same path.
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
	"errors"
	"fmt"
	dbpkg "github.com/miquelrosell99/sonarly/server/internal/db"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
)

// AUDIO_EXTS is the extension set v1 scanned.
var AUDIO_EXTS = map[string]bool{".mp3": true, ".flac": true, ".ogg": true, ".m4a": true}

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
		uuid.NewString(), name, path, now, now, DefaultOrganizePattern)
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

	persist := func(existingID *string) error {
		_, err := PersistSong(ctx, s.db, PersistInput{
			ExistingID: existingID,
			Path:       path,
			Meta:       meta,
			Mtime:      mtime,
			Checksum:   checksum,
			LibraryID:  libraryID,
		})
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
			if err := persist(&target.id); err != nil {
				return err
			}
			movedFromPaths[target.filePath] = struct{}{}
			stats.Moved++
			return nil
		}
		if err := persist(nil); err != nil {
			return err
		}
		stats.Added++
		return nil
	default:
		if err := persist(&existing.id); err != nil {
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
	// Close before the follow-up lookups below: the pool has a single
	// connection, so any query while this cursor is open would deadlock.
	if err := rows.Close(); err != nil {
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
	rows, err := s.db.QueryContext(ctx, `SELECT rowid, id, file_path FROM songs WHERE active = 1`)
	if err != nil {
		return fmt.Errorf("list active songs: %w", err)
	}
	defer rows.Close()

	type activeSong struct {
		rowid int64
		id    string
	}
	var toDeactivate []activeSong
	for rows.Next() {
		var row activeSong
		var path string
		if err := rows.Scan(&row.rowid, &row.id, &path); err != nil {
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
		toDeactivate = append(toDeactivate, row)
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
	ftsStmt, err := tx.PrepareContext(ctx, `DELETE FROM songs_fts WHERE rowid = ?`)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("prepare fts deactivation: %w", err)
	}
	defer ftsStmt.Close()
	for _, song := range toDeactivate {
		if _, err := stmt.ExecContext(ctx, song.id); err != nil {
			tx.Rollback()
			return fmt.Errorf("deactivate song %s: %w", song.id, err)
		}
		// The search index tracks the live catalog: a deactivated song's
		// tokens leave it in the same tx (reactivation re-inserts via
		// PersistSong's sync).
		if _, err := ftsStmt.ExecContext(ctx, song.rowid); err != nil {
			tx.Rollback()
			return fmt.Errorf("deactivate song %s (fts): %w", song.id, err)
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
// Row helpers
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
	var mtime dbpkg.Millis
	if err := row.Scan(&r.id, &r.filePath, &mtime, &active, &r.albumID, &r.coverArtID, &missing, &r.libraryID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load song by path: %w", err)
	}
	r.mtime = int64(mtime)
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
