// Review-folder retention cleanup (v1 review-cleanup.ts): files parked in
// any review/ folder under the ingest path older than the retention setting
// are deleted. Runs as the cleanup_review scan_jobs type, enqueued daily by
// the library scheduler; the handler marks last_review_cleanup on success
// (v1's worker did), which is the scheduler's interval anchor.
package ingest

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
)

// ReviewCleanupStats is v1's ReviewCleanupStats.
type ReviewCleanupStats struct {
	Deleted int `json:"deleted"`
	Failed  int `json:"failed"`
}

// settingLastReviewCleanup is the scheduler's last-run anchor (v1 key name).
const settingLastReviewCleanup = "last_review_cleanup"

// RunReviewCleanupJob is the library.Worker handler for cleanup_review jobs.
func (s *Service) RunReviewCleanupJob(ctx context.Context, job *library.Job) (any, error) {
	return s.RunReviewCleanup(ctx, time.Now())
}

// RunReviewCleanup deletes aged files from every review/ folder under the
// configured ingest path. With no ingest path configured there is nothing
// to clean: it succeeds with zero stats rather than failing the daily job.
func (s *Service) RunReviewCleanup(ctx context.Context, now time.Time) (*ReviewCleanupStats, error) {
	stats := &ReviewCleanupStats{}
	if s.ingestPath == "" {
		s.log.WarnContext(ctx, "review cleanup: no ingest path configured, skipping")
		return stats, nil
	}
	retention := s.reviewRetentionDays(ctx)
	if err := s.cleanupReviewTree(ctx, s.ingestPath, retention, now, stats); err != nil {
		return stats, err
	}
	if err := s.setSetting(ctx, settingLastReviewCleanup, now.UTC().Format(time.RFC3339)); err != nil {
		return stats, err
	}
	return stats, nil
}

// cleanupReviewTree walks the ingest tree; a directory named "review" is
// swept but never descended into (v1 cleanupAllReviewFolders).
func (s *Service) cleanupReviewTree(ctx context.Context, dir string, retentionDays int, now time.Time, stats *ReviewCleanupStats) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		// Unreadable trees are skipped, as v1's try/catch did.
		return nil
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !entry.IsDir() {
			continue
		}
		fullPath := filepath.Join(dir, entry.Name())
		if entry.Name() == "review" {
			s.cleanupReviewFolder(ctx, fullPath, retentionDays, now, stats)
			continue
		}
		if err := s.cleanupReviewTree(ctx, fullPath, retentionDays, now, stats); err != nil {
			return err
		}
	}
	return nil
}

// cleanupReviewFolder deletes the folder's FILES older than the retention;
// per-file failures are counted, never fatal (v1 cleanupReviewFolder).
func (s *Service) cleanupReviewFolder(ctx context.Context, dir string, retentionDays int, now time.Time, stats *ReviewCleanupStats) {
	cutoff := now.Add(-time.Duration(retentionDays) * 24 * time.Hour)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			filePath := filepath.Join(dir, entry.Name())
			info, err := os.Stat(filePath)
			if err != nil {
				stats.Failed++
				continue
			}
			if info.ModTime().Before(cutoff) {
				if err := os.Remove(filePath); err != nil {
					stats.Failed++
					continue
				}
				stats.Deleted++
			}
		}
	}
}
