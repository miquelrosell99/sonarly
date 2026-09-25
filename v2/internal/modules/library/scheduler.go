// Scheduler enqueues interval-based jobs with persisted last-run timestamps
// and no-overlap guards — v1 ScanScheduler/ArtistImageScheduler/
// IngestScheduler semantics on one ticker. Interval 0 (or negative)
// disables a trigger; the first tick after boot only records the timestamp
// (v1 priming), so enabling an interval never fires a job immediately.
package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// Scheduler tick cadence while running; the per-trigger intervals are read
// from config in minutes, so a 1s cadence matches v1's per-loop tick.
const schedulerTick = time.Second

// Interval settings keys in the settings table (v1 key names).
const (
	settingLastPeriodicScan    = "last_periodic_scan"
	settingLastArtistImageSync = "last_artist_image_sync"
	settingLastPeriodicIngest  = "last_periodic_ingest"
)

// SchedulerOptions carries the per-trigger intervals; zero disables.
type SchedulerOptions struct {
	ScanInterval        time.Duration
	ArtistImageInterval time.Duration
	IngestInterval      time.Duration
	IngestPath          string
}

// Scheduler fires periodic jobs.
type Scheduler struct {
	db      *sql.DB
	queue   *Queue
	log     *slog.Logger
	options SchedulerOptions
}

func NewScheduler(db *sql.DB, queue *Queue, log *slog.Logger, options SchedulerOptions) *Scheduler {
	return &Scheduler{db: db, queue: queue, log: log, options: options}
}

// Run ticks until ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) {
	s.log.InfoContext(ctx, "scheduler started",
		"scan_interval", s.options.ScanInterval.String(),
		"artist_image_interval", s.options.ArtistImageInterval.String(),
		"ingest_interval", s.options.IngestInterval.String())
	ticker := time.NewTicker(schedulerTick)
	defer ticker.Stop()
	for {
		if err := s.Tick(ctx, time.Now()); err != nil && !errors.Is(err, context.Canceled) {
			s.log.WarnContext(ctx, "scheduler tick failed", "err", err)
		}
		select {
		case <-ctx.Done():
			s.log.InfoContext(ctx, "scheduler stopped")
			return
		case <-ticker.C:
		}
	}
}

// Tick evaluates every trigger against now. It is exported so tests can
// drive it with a fake clock.
func (s *Scheduler) Tick(ctx context.Context, now time.Time) error {
	if err := s.tickScan(ctx, now); err != nil {
		return err
	}
	if err := s.tickArtistImages(ctx, now); err != nil {
		return err
	}
	return s.tickIngest(ctx, now)
}

func (s *Scheduler) tickScan(ctx context.Context, now time.Time) error {
	if s.options.ScanInterval <= 0 {
		return nil
	}
	due, err := s.due(ctx, settingLastPeriodicScan, s.options.ScanInterval, now)
	if err != nil || !due {
		return err
	}
	// No-overlap guard (v1): never stack a periodic scan on top of a
	// pending/running scan or resync.
	pending, err := s.hasPendingOrRunning(ctx, JobTypeScan, JobTypeResync)
	if err != nil || pending {
		return err
	}
	if _, err := s.queue.Push(ctx, JobTypeScan, ScanPayload{}); err != nil {
		return err
	}
	return s.markRan(ctx, settingLastPeriodicScan, now)
}

func (s *Scheduler) tickArtistImages(ctx context.Context, now time.Time) error {
	if s.options.ArtistImageInterval <= 0 {
		return nil
	}
	due, err := s.due(ctx, settingLastArtistImageSync, s.options.ArtistImageInterval, now)
	if err != nil || !due {
		return err
	}
	pending, err := s.hasPendingOrRunning(ctx, JobTypeArtistImages)
	if err != nil || pending {
		return err
	}
	if _, err := s.queue.Push(ctx, JobTypeArtistImages, ArtistImagesPayload{RefetchExisting: true}); err != nil {
		return err
	}
	return s.markRan(ctx, settingLastArtistImageSync, now)
}

func (s *Scheduler) tickIngest(ctx context.Context, now time.Time) error {
	if s.options.IngestInterval <= 0 {
		return nil
	}
	due, err := s.due(ctx, settingLastPeriodicIngest, s.options.IngestInterval, now)
	if err != nil || !due {
		return err
	}
	pending, err := s.hasPendingOrRunning(ctx, JobTypeIngest)
	if err != nil || pending {
		return err
	}
	if _, err := s.queue.Push(ctx, JobTypeIngest, IngestPayload{SourcePath: s.options.IngestPath}); err != nil {
		return err
	}
	return s.markRan(ctx, settingLastPeriodicIngest, now)
}

// due reports whether the trigger's interval has elapsed since its persisted
// last-run. A missing or unparseable timestamp is (re)primed to now without
// firing — v1 semantics.
func (s *Scheduler) due(ctx context.Context, key string, interval time.Duration, now time.Time) (bool, error) {
	raw, err := getSetting(ctx, s.db, key)
	if err != nil {
		return false, err
	}
	if raw == "" {
		return false, s.markRan(ctx, key, now)
	}
	last, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		s.log.WarnContext(ctx, "scheduler: unparseable last-run timestamp, repriming", "key", key, "value", raw)
		return false, s.markRan(ctx, key, now)
	}
	return now.Sub(last) >= interval, nil
}

func (s *Scheduler) markRan(ctx context.Context, key string, now time.Time) error {
	return setSetting(ctx, s.db, key, now.UTC().Format(time.RFC3339))
}

func (s *Scheduler) hasPendingOrRunning(ctx context.Context, types ...JobType) (bool, error) {
	query := `SELECT 1 FROM scan_jobs WHERE status IN ('pending', 'running') AND type IN (`
	args := make([]any, 0, len(types))
	for i, t := range types {
		if i > 0 {
			query += ", "
		}
		query += "?"
		args = append(args, string(t))
	}
	query += ") LIMIT 1"
	var one int
	err := s.db.QueryRowContext(ctx, query, args...).Scan(&one)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return false, fmt.Errorf("check pending jobs: %w", err)
}

// getSetting/setSetting read and write the settings table (v1 settings
// feature, key/value strings).
func getSetting(ctx context.Context, db *sql.DB, key string) (string, error) {
	var value string
	err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load setting %s: %w", key, err)
	}
	return value, nil
}

func setSetting(ctx context.Context, db *sql.DB, key, value string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
		key, value)
	if err != nil {
		return fmt.Errorf("save setting %s: %w", key, err)
	}
	return nil
}
