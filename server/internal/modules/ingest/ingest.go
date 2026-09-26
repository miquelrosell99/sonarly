// The ingest pipeline: walk a drop folder, validate each audio file, route
// invalid ones to review/, move valid ones into the target library along
// the organize pattern, resolve duplicates by strategy, and persist every
// imported song through library.PersistSong. Ports the old
// features/ingest/ingest.ts with per-file failure isolation, ingest_jobs
// bookkeeping (run_id = the scan_jobs job id), companion cover images, and
// empty-dir pruning.
package ingest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// Statuses stored in ingest_jobs.status (old IngestStatus).
const (
	StatusPending     = "pending"
	StatusNeedsReview = "needs_review"
	StatusImported    = "imported"
	StatusSkipped     = "skipped"
	StatusFailed      = "failed"
)

// maxFailures caps the per-file failure list; the failure count itself is
// not capped (the old cap-20 list).
const maxFailures = 20

var companionImageExts = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true, ".bmp": true}
var companionImageNames = map[string]bool{"cover": true, "folder": true, "album": true, "front": true, "art": true}

// Failure is one per-file error captured during a run.
type Failure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

// Stats is the old IngestStats plus the capped failure list.
type Stats struct {
	Processed   int       `json:"processed"`
	Imported    int       `json:"imported"`
	Updated     int       `json:"updated"`
	Duplicates  int       `json:"duplicates"`
	NeedsReview int       `json:"needsReview"`
	Failed      int       `json:"failed"`
	Failures    []Failure `json:"failures,omitempty"`
}

// targetLibrary is the resolved ingest destination: the payload's library
// when set (typed payload — the old bare-path bug is impossible by
// construction), else the default library, else the configured library
// path fallback with the global organize pattern.
type targetLibrary struct {
	id      *string
	path    string
	pattern string
}

func (s *Service) resolveTargetLibrary(ctx context.Context, libraryID string) (*targetLibrary, error) {
	if libraryID != "" {
		var path, pattern string
		err := s.db.QueryRowContext(ctx,
			`SELECT path, organize_pattern FROM libraries WHERE id = ?`, libraryID).
			Scan(&path, &pattern)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: %s", library.ErrLibraryNotFound, libraryID)
		}
		if err != nil {
			return nil, fmt.Errorf("load library %s: %w", libraryID, err)
		}
		return &targetLibrary{id: &libraryID, path: path, pattern: pattern}, nil
	}
	var id, path, pattern string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, path, organize_pattern FROM libraries WHERE is_default = 1 LIMIT 1`).
		Scan(&id, &path, &pattern)
	if err == nil {
		return &targetLibrary{id: &id, path: path, pattern: pattern}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load default library: %w", err)
	}
	if s.libraryPath == "" {
		return nil, errors.New("no library configured")
	}
	return &targetLibrary{path: s.libraryPath}, nil
}

// RunIngestJob is the library.Worker handler for ingest jobs.
func (s *Service) RunIngestJob(ctx context.Context, job *library.Job) (any, error) {
	var payload library.IngestPayload
	if err := job.DecodePayload(&payload); err != nil {
		return nil, err
	}
	return s.RunIngest(ctx, payload, job.ID, func(stats *Stats) {
		// Best-effort live progress; a cancelled context simply stops the
		// updates.
		_ = s.queue.UpdateStats(ctx, job.ID, stats)
	})
}

// RunIngest ports the old processIngestFolder. runID (the scan_jobs job id)
// batches this run's ingest_jobs rows. Cancellation aborts the walk between
// files and surfaces as an error, like the scanner.
func (s *Service) RunIngest(ctx context.Context, payload library.IngestPayload, runID string, onProgress func(*Stats)) (*Stats, error) {
	stats := &Stats{}

	root := payload.SourcePath
	if root == "" {
		root = s.ingestPath
	}
	if root == "" {
		return nil, errors.New("ingest source path not configured")
	}
	target, err := s.resolveTargetLibrary(ctx, payload.LibraryID)
	if err != nil {
		return nil, err
	}
	pattern := target.pattern
	if pattern == "" {
		pattern = s.globalOrganizePattern(ctx)
	}
	strategy := duplicateStrategyDefault
	if IsStrategy(payload.DuplicateStrategy) {
		strategy = Strategy(payload.DuplicateStrategy)
	} else if configured := s.settingsDuplicateStrategy(ctx); configured != "" {
		strategy = configured
	}

	reviewDir := filepath.Join(root, "review")
	if err := os.MkdirAll(reviewDir, 0o755); err != nil {
		return nil, fmt.Errorf("create review dir: %w", err)
	}

	importedSourceDirs := map[string]string{}
	reviewSourceDirs := map[string]bool{}

	files, err := walkIngestFiles(root)
	if err != nil {
		return nil, err
	}
	for _, filePath := range files {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		stats.Processed++
		sourceDir := filepath.Dir(filePath)
		jobID, err := s.createIngestJob(ctx, filePath, runID)
		if err != nil {
			return stats, err
		}
		if err := s.processFile(ctx, filePath, sourceDir, root, reviewDir, pattern, target, strategy, jobID, stats, importedSourceDirs, reviewSourceDirs); err != nil {
			s.failFile(ctx, jobID, filePath, err, stats)
		}
		if onProgress != nil {
			onProgress(stats)
		}
	}

	// Companion cover art follows the album folder its songs landed in.
	for sourceDir, targetDir := range importedSourceDirs {
		if err := moveCompanionImages(sourceDir, targetDir); err != nil {
			s.log.WarnContext(ctx, "ingest: failed to move companion images", "dir", sourceDir, "err", err)
		}
	}
	// ...and art from folders where every audio file went to review follows
	// those files into the review folder.
	for sourceDir := range reviewSourceDirs {
		if err := moveCompanionImages(sourceDir, reviewDir); err != nil {
			s.log.WarnContext(ctx, "ingest: failed to move companion images to review", "dir", sourceDir, "err", err)
		}
	}

	cleanupEmptyDirs(root, root, reviewDir)
	return stats, nil
}

// processFile ingests one validated file and updates its ingest_jobs row;
// any error is returned for the caller's failure bookkeeping (the old
// try/catch around the per-file body).
func (s *Service) processFile(ctx context.Context, filePath, sourceDir, root, reviewDir, pattern string, target *targetLibrary, strategy Strategy, jobID string, stats *Stats, importedSourceDirs map[string]string, reviewSourceDirs map[string]bool) error {
	validation := ValidateFile(filePath)
	if !validation.Valid {
		if _, err := moveToReview(filePath, reviewDir); err != nil {
			return err
		}
		if err := s.updateIngestJob(ctx, jobID, StatusNeedsReview, nil, string(validation.Reason), false, ""); err != nil {
			return err
		}
		stats.NeedsReview++
		if sourceDir != root {
			if _, imported := importedSourceDirs[sourceDir]; !imported {
				reviewSourceDirs[sourceDir] = true
			}
		}
		return nil
	}

	meta := validation.Meta
	info, err := os.Stat(filePath)
	if err != nil {
		return err
	}
	mtime := info.ModTime().UnixMilli()
	checksum, err := library.ChecksumFile(filePath)
	if err != nil {
		return err
	}
	targetPath := BuildTargetPath(pattern, target.path, meta, filePath)

	resolution, err := HandleDuplicate(ctx, s.db, filePath, targetPath, meta, mtime, checksum, target.id, strategy)
	if err != nil {
		return err
	}
	if resolution != nil {
		status := StatusImported
		if resolution.Skipped {
			status = StatusSkipped
		}
		var finalPath *string
		if resolution.FinalPath != "" {
			finalPath = &resolution.FinalPath
		}
		if err := s.updateIngestJob(ctx, jobID, status, finalPath, "", true, string(strategy)); err != nil {
			return err
		}
		if !resolution.Skipped {
			stats.Imported++
		}
		if resolution.Updated {
			stats.Updated++
		}
		stats.Duplicates++
		if sourceDir != root && resolution.FinalPath != "" {
			importedSourceDirs[sourceDir] = filepath.Dir(resolution.FinalPath)
			delete(reviewSourceDirs, sourceDir)
		}
		return nil
	}

	finalPath, err := MoveToLibrary(filePath, targetPath)
	if err != nil {
		return err
	}
	if _, err := library.PersistSong(ctx, s.db, library.PersistInput{
		Path:      finalPath,
		Meta:      meta,
		Mtime:     mtime,
		Checksum:  checksum,
		LibraryID: target.id,
	}); err != nil {
		return err
	}
	if err := s.updateIngestJob(ctx, jobID, StatusImported, &finalPath, "", false, ""); err != nil {
		return err
	}
	stats.Imported++
	if sourceDir != root {
		importedSourceDirs[sourceDir] = filepath.Dir(finalPath)
		delete(reviewSourceDirs, sourceDir)
	}
	return nil
}

// failFile is the old catch block: the job row is marked failed, the failure
// counted, and (below the cap) listed — the walk continues.
func (s *Service) failFile(ctx context.Context, jobID, path string, runErr error, stats *Stats) {
	_ = s.updateIngestJob(context.WithoutCancel(ctx), jobID, StatusFailed, nil, runErr.Error(), false, "")
	stats.Failed++
	if len(stats.Failures) < maxFailures {
		stats.Failures = append(stats.Failures, Failure{Path: path, Error: runErr.Error()})
	}
	s.log.WarnContext(ctx, "ingest: failed to import file", "path", path, "err", runErr)
}

// walkIngestFiles ports the old walkIngestFiles: recursive, audio extensions
// only, and only the TOP-LEVEL review directory is skipped — a 'review'
// folder nested deeper is legitimate user content. Entries come back in
// name order (os.ReadDir sorts), like fs.readdir.
func walkIngestFiles(root string) ([]string, error) {
	var files []string
	err := walkIngestFilesInto(root, root, &files)
	return files, err
}

func walkIngestFilesInto(dir, root string, out *[]string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		// Unreadable directories are skipped, as the old try/catch did.
		return nil
	}
	for _, entry := range entries {
		fullPath := filepath.Join(dir, entry.Name())
		if entry.IsDir() {
			if dir == root && entry.Name() == "review" {
				continue
			}
			if err := walkIngestFilesInto(fullPath, root, out); err != nil {
				return err
			}
			continue
		}
		if library.AUDIO_EXTS[strings.ToLower(filepath.Ext(entry.Name()))] {
			*out = append(*out, fullPath)
		}
	}
	return nil
}

// moveToReview parks an invalid file in the review folder, flat, with a
// " (n)" suffix on collision (old moveToReview + resolveUniquePath).
func moveToReview(sourcePath, reviewDir string) (string, error) {
	target, err := ResolveDuplicateTarget(filepath.Join(reviewDir, filepath.Base(sourcePath)))
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", err
	}
	if err := moveFile(sourcePath, target); err != nil {
		return "", err
	}
	return target, nil
}

// moveCompanionImages ports the old moveCompanionImages: image files named
// cover/folder/album/front/art (any of six extensions) follow their album
// folder into the library, or into review/ when every song was rejected.
func moveCompanionImages(sourceDir, targetDir string) error {
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			base := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
			if companionImageExts[ext] && companionImageNames[base] {
				if _, err := MoveToLibrary(filepath.Join(sourceDir, entry.Name()), filepath.Join(targetDir, entry.Name())); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// ingest_jobs rows (old features/ingest/repository.ts)
// ---------------------------------------------------------------------------

// IngestJob is one ingest_jobs row.
type IngestJob struct {
	ID                string  `json:"id"`
	RunID             string  `json:"runId"`
	SourcePath        string  `json:"sourcePath"`
	Status            string  `json:"status"`
	TargetPath        *string `json:"targetPath"`
	Error             *string `json:"error"`
	Duplicate         bool    `json:"duplicate"`
	DuplicateStrategy *string `json:"duplicateStrategy"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

// createIngestJob opens the per-file row before any work happens, so a file
// that never finishes still leaves a trace (old createIngestJob).
func (s *Service) createIngestJob(ctx context.Context, sourcePath, runID string) (string, error) {
	id := uuid.NewString()
	if runID == "" {
		runID = "unknown"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO ingest_jobs (id, run_id, source_path, status) VALUES (?, ?, ?, ?)`,
		id, runID, sourcePath, StatusPending)
	if err != nil {
		return "", fmt.Errorf("create ingest job: %w", err)
	}
	return id, nil
}

func (s *Service) updateIngestJob(ctx context.Context, id, status string, targetPath *string, errorMessage string, duplicate bool, strategy string) error {
	var target, errMsg any
	if targetPath != nil {
		target = *targetPath
	}
	if errorMessage != "" {
		errMsg = errorMessage
	}
	var strategyArg any
	if strategy != "" {
		strategyArg = strategy
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE ingest_jobs
		 SET status = ?, target_path = ?, error = ?, duplicate = ?, duplicate_strategy = ?, updated_at = datetime('now')
		 WHERE id = ?`,
		status, target, errMsg, duplicate, strategyArg, id)
	if err != nil {
		return fmt.Errorf("update ingest job %s: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("update ingest job %s: no row", id)
	}
	return nil
}

// ListIngestJobs returns the newest 100 rows (old GET /api/ingest).
func (s *Service) ListIngestJobs(ctx context.Context) ([]IngestJob, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, COALESCE(run_id, ''), source_path, status, target_path, error, duplicate, duplicate_strategy, created_at, updated_at
		 FROM ingest_jobs ORDER BY created_at DESC, rowid DESC LIMIT 100`)
	if err != nil {
		return nil, fmt.Errorf("list ingest jobs: %w", err)
	}
	defer rows.Close()
	return scanIngestJobs(rows)
}

// GetIngestJob returns one row, or nil when it does not exist.
func (s *Service) GetIngestJob(ctx context.Context, id string) (*IngestJob, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, COALESCE(run_id, ''), source_path, status, target_path, error, duplicate, duplicate_strategy, created_at, updated_at
		 FROM ingest_jobs WHERE id = ?`, id)
	job, err := scanIngestJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load ingest job %s: %w", id, err)
	}
	return job, nil
}

// DeleteIngestJob deletes one row; false means it did not exist (the old
// changes === 0 → 404).
func (s *Service) DeleteIngestJob(ctx context.Context, id string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM ingest_jobs WHERE id = ?`, id)
	if err != nil {
		return false, fmt.Errorf("delete ingest job %s: %w", id, err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// DeleteAllIngestJobs wipes the table (old DELETE /api/ingest).
func (s *Service) DeleteAllIngestJobs(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM ingest_jobs`)
	if err != nil {
		return fmt.Errorf("delete ingest jobs: %w", err)
	}
	return nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanIngestJob(row rowScanner) (*IngestJob, error) {
	var job IngestJob
	var targetPath, errorMessage, strategy *string
	var duplicate int
	if err := row.Scan(&job.ID, &job.RunID, &job.SourcePath, &job.Status,
		&targetPath, &errorMessage, &duplicate, &strategy, &job.CreatedAt, &job.UpdatedAt); err != nil {
		return nil, err
	}
	job.TargetPath = targetPath
	job.Error = errorMessage
	job.Duplicate = duplicate == 1
	job.DuplicateStrategy = strategy
	return &job, nil
}

func scanIngestJobs(rows *sql.Rows) ([]IngestJob, error) {
	var jobs []IngestJob
	for rows.Next() {
		job, err := scanIngestJob(rows)
		if err != nil {
			return nil, fmt.Errorf("list ingest jobs: %w", err)
		}
		jobs = append(jobs, *job)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list ingest jobs: %w", err)
	}
	return jobs, nil
}
