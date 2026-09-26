// Organize-existing: re-apply each library's organize pattern to files
// already in the library (old organize-job.ts two-phase runner +
// organize-existing.ts helpers). Phase one collects candidates without
// touching anything; phase two moves them with per-file progress and a
// failedPaths list. A moved file's song row follows it, and the cover link
// is reconciled in the database — the retired server rewrote the album cover INTO the moved
// file; the Go server never mutates audio files.
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
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// OrganizeStats is the old OrganizeJobStats (the scan_jobs stats document).
type OrganizeStats struct {
	Total       int      `json:"total"`
	Scanned     int      `json:"scanned"`
	Done        int      `json:"done"`
	Moved       int      `json:"moved"`
	Skipped     int      `json:"skipped"`
	Failed      int      `json:"failed"`
	FailedPaths []string `json:"failedPaths"`
	CurrentPath string   `json:"currentPath,omitempty"`
}

// RunOrganizeJob is the library.Worker handler for organize jobs.
func (s *Service) RunOrganizeJob(ctx context.Context, job *library.Job) (any, error) {
	var payload library.OrganizePayload
	if err := job.DecodePayload(&payload); err != nil {
		return nil, err
	}
	return s.RunOrganize(ctx, payload, func(stats *OrganizeStats) {
		_ = s.queue.UpdateStats(ctx, job.ID, stats)
	})
}

// RunOrganize ports the old runOrganizeJob: collect candidates (read-only
// preview of every file's target path), then move them one at a time with
// live stats, and finally prune emptied directories.
func (s *Service) RunOrganize(ctx context.Context, payload library.OrganizePayload, onProgress func(*OrganizeStats)) (*OrganizeStats, error) {
	stats := &OrganizeStats{FailedPaths: []string{}}

	roots, err := s.organizeRoots(ctx, payload.LibraryID)
	if err != nil {
		return nil, err
	}

	var candidates []string
	for _, root := range roots {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		files := walkLibraryFiles(root)
		for _, filePath := range files {
			stats.Scanned++
			targetPath, err := s.targetPathForFile(ctx, filePath)
			if err != nil {
				stats.Failed++
				stats.FailedPaths = append(stats.FailedPaths, filePath)
				s.log.WarnContext(ctx, "organize: preview failed", "path", filePath, "err", err)
				continue
			}
			if targetPath != filePath {
				candidates = append(candidates, filePath)
			} else {
				stats.Skipped++
			}
		}
	}

	stats.Total = len(candidates)
	if onProgress != nil {
		onProgress(stats)
	}

	for _, filePath := range candidates {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		stats.CurrentPath = filePath
		if onProgress != nil {
			onProgress(stats)
		}

		finalPath, err := s.organizeSongFile(ctx, filePath)
		if err != nil {
			stats.Failed++
			stats.FailedPaths = append(stats.FailedPaths, filePath)
			s.log.WarnContext(ctx, "organize: move failed", "path", filePath, "err", err)
		} else if finalPath == filePath {
			stats.Skipped++
		} else {
			stats.Moved++
		}

		stats.Done++
		if onProgress != nil {
			onProgress(stats)
		}
	}

	stats.CurrentPath = ""
	for _, root := range roots {
		cleanupEmptyDirs(root, root, "")
	}
	return stats, nil
}

// organizeRoots resolves which library roots an organize job covers: the
// payload's library when set, otherwise every library (wire parity), falling
// back to the configured library path when no libraries row exists.
func (s *Service) organizeRoots(ctx context.Context, libraryID string) ([]string, error) {
	if libraryID != "" {
		var path string
		err := s.db.QueryRowContext(ctx, `SELECT path FROM libraries WHERE id = ?`, libraryID).Scan(&path)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: %s", library.ErrLibraryNotFound, libraryID)
		}
		if err != nil {
			return nil, fmt.Errorf("load library %s: %w", libraryID, err)
		}
		return []string{path}, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT path FROM libraries ORDER BY path`)
	if err != nil {
		return nil, fmt.Errorf("list libraries: %w", err)
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, fmt.Errorf("list libraries: %w", err)
		}
		paths = append(paths, path)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list libraries: %w", err)
	}
	if len(paths) == 0 && s.libraryPath != "" {
		paths = append(paths, s.libraryPath)
	}
	if len(paths) == 0 {
		return nil, errors.New("no library configured")
	}
	return paths, nil
}

// targetPathForFile ports the old getTargetPathForFile: the file's own tags
// (re-read), its library resolved by longest-prefix separator-boundary
// match (so /music does not claim /music2), the library's organize pattern
// or the global fallback.
func (s *Service) targetPathForFile(ctx context.Context, filePath string) (string, error) {
	meta, err := audio.ReadMetadata(filePath)
	if err != nil {
		return "", err
	}
	return s.targetPathForMeta(ctx, filePath, meta)
}

func (s *Service) targetPathForMeta(ctx context.Context, filePath string, meta *audio.Metadata) (string, error) {
	libraryID, err := library.ResolveLibraryIDForPath(ctx, s.db, filePath)
	if err != nil {
		return "", err
	}
	if libraryID != nil {
		var path, pattern string
		if err := s.db.QueryRowContext(ctx,
			`SELECT path, organize_pattern FROM libraries WHERE id = ?`, *libraryID).
			Scan(&path, &pattern); err != nil {
			return "", fmt.Errorf("load library %s: %w", *libraryID, err)
		}
		if pattern != "" {
			return BuildTargetPath(pattern, path, meta, filePath), nil
		}
		return BuildTargetPath(s.globalOrganizePattern(ctx), path, meta, filePath), nil
	}
	if s.libraryPath == "" {
		return "", errors.New("no library configured for " + filePath)
	}
	return BuildTargetPath(s.globalOrganizePattern(ctx), s.libraryPath, meta, filePath), nil
}

// organizeSongFile ports the old organizeSongFile: resolve the pattern target,
// move with collision handling, and point the song row at the new path. The
// the Go server deviation is the cover sync: the retired server embedded the album's cover art into the
// moved audio file; the Go server reconciles the song's cover_art_id link in the
// database only (read-only doctrine — no audio file is ever mutated).
func (s *Service) organizeSongFile(ctx context.Context, filePath string) (string, error) {
	var songID string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM songs WHERE file_path = ?`, filePath).Scan(&songID)
	dbSong := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load song %s: %w", filePath, err)
	}

	meta, err := audio.ReadMetadata(filePath)
	if err != nil {
		return "", err
	}
	targetPath, err := s.targetPathForMeta(ctx, filePath, meta)
	if err != nil {
		return "", err
	}
	if filePath == targetPath {
		return filePath, nil
	}

	finalPath, err := MoveToLibrary(filePath, targetPath)
	if err != nil {
		return "", err
	}

	if dbSong {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE songs SET file_path = ? WHERE id = ?`, finalPath, songID); err != nil {
			return "", fmt.Errorf("update song path: %w", err)
		}
		if err := s.syncSongCoverWithAlbum(ctx, songID); err != nil {
			return "", err
		}
	}
	return finalPath, nil
}

// syncSongCoverWithAlbum reconciles the song's cover link with its album's
// cover after a move (the database-side equivalent of the old 
// syncSongCoverWithAlbum, which rewrote tags).
func (s *Service) syncSongCoverWithAlbum(ctx context.Context, songID string) error {
	var albumID *string
	if err := s.db.QueryRowContext(ctx,
		`SELECT album_id FROM songs WHERE id = ?`, songID).Scan(&albumID); err != nil {
		return fmt.Errorf("load song album: %w", err)
	}
	if albumID == nil {
		return nil
	}
	var albumCover *string
	if err := s.db.QueryRowContext(ctx,
		`SELECT cover_art_id FROM albums WHERE id = ?`, *albumID).Scan(&albumCover); err != nil {
		return fmt.Errorf("load album cover: %w", err)
	}
	if albumCover == nil {
		return nil
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE songs SET cover_art_id = ? WHERE id = ?`, *albumCover, songID); err != nil {
		return fmt.Errorf("update song cover: %w", err)
	}
	return nil
}

// walkLibraryFiles ports the old walkLibraryFiles: every audio file under the
// root, name order. (Deliberately no dotfile skip — wire parity; non-audio
// extensions are filtered out.)
func walkLibraryFiles(dir string) []string {
	var files []string
	entries, err := os.ReadDir(dir)
	if err != nil {
		return files
	}
	for _, entry := range entries {
		fullPath := filepath.Join(dir, entry.Name())
		if entry.IsDir() {
			files = append(files, walkLibraryFiles(fullPath)...)
			continue
		}
		if library.AUDIO_EXTS[strings.ToLower(filepath.Ext(entry.Name()))] {
			files = append(files, fullPath)
		}
	}
	return files
}

// OrganizeSongFile is the exported entry point for modules that mutate a
// file's tags and then re-apply the library's organize pattern (the tag-edit
// flow): resolve the target from the file's fresh tags, move, and reconcile
// the song row. It delegates to organizeSongFile.
func (s *Service) OrganizeSongFile(ctx context.Context, filePath string) (string, error) {
	return s.organizeSongFile(ctx, filePath)
}
