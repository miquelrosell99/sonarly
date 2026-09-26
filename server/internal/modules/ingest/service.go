// Package ingest is the Go counterpart of the old features/ingest/ +
// features/duplicates/ + features/conflicts/: the ingest pipeline (validate
// → organize-pattern target → duplicate resolution → move → PersistSong),
// the organize-existing job, review-folder retention cleanup, and the admin
// routes. It writes songs through library.PersistSong — the same single data
// path the scanner uses — so an ingested song and a scanned song produce
// identical rows.
//
// the old lessons engineered in (P7b):
//
//   - IngestPayload is typed (P4b): the payload's LibraryID names the target
//     library, so the old bare-path producer bug (a library path smuggled in as
//     the ingest source) is impossible by construction.
//   - replace_file_and_metadata never clobbers an occupied target: when the
//     pattern target differs from the matched file and is taken, a " (n)"
//     suffix is chosen instead (old organizer + duplicates fix).
//   - keep-file strategies preserve the existing file's mtime/checksum on
//     the row and never touch the file on disk; metadata merge modes are
//     the old aggregate / replacePresentOnly, ported in library.PersistSong.
//   - Per-file failure isolation with a capped failure list (the old cap-20),
//     EXDEV copy+unlink moves verified by checksum, companion cover images
//     follow their album folder, emptied dirs are pruned, and a review/
//     subfolder sweep never re-ingests files parked for review.
package ingest

import (
	"database/sql"
	"log/slog"

	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// duplicateStrategyDefault mirrors the retired server settings.DEFAULT_DUPLICATE_STRATEGY.
const duplicateStrategyDefault = StrategyKeepFileReplaceMetadata

// reviewRetentionDefault mirrors the retired server config REVIEW_RETENTION_DAYS.
const reviewRetentionDefault = 30

// reviewRetentionMin/Max mirror the old zod clamp on REVIEW_RETENTION_DAYS.
const (
	reviewRetentionMin = 1
	reviewRetentionMax = 365
)

// Options carries the ingest module's configuration.
type Options struct {
	// IngestPath is the configured drop folder (SONARLY_INGEST_PATH); ""
	// disables the periodic sweep and review cleanup.
	IngestPath string
	// LibraryPath is the configured library root, the fallback target when
	// no libraries row exists (old config.LIBRARY_PATH fallback).
	LibraryPath string
	// ReviewRetentionDays is the default review/ retention; the settings
	// table key review_retention_days overrides it (clamped 1–365, the retired server).
	ReviewRetentionDays int
}

// Service runs ingest jobs. It is registered on the library worker for the
// ingest, organize and cleanup_review job types.
type Service struct {
	db          *sql.DB
	log         *slog.Logger
	queue       *library.Queue
	ingestPath  string
	libraryPath string
	retention   int
}

// NewService constructs the ingest service.
func NewService(db *sql.DB, log *slog.Logger, queue *library.Queue, opts Options) *Service {
	retention := opts.ReviewRetentionDays
	if retention < reviewRetentionMin || retention > reviewRetentionMax {
		retention = reviewRetentionDefault
	}
	return &Service{
		db:          db,
		log:         log,
		queue:       queue,
		ingestPath:  opts.IngestPath,
		libraryPath: opts.LibraryPath,
		retention:   retention,
	}
}
