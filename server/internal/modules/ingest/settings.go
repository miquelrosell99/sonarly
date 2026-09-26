// Settings readers for the ingest pipeline: the v1 settings table keys with
// their defaults (settings/repository.ts).
package ingest

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

const (
	settingOrganizePattern   = "organize_pattern"
	settingDuplicateStrategy = "duplicate_strategy"
	settingReviewRetention   = "review_retention_days"
)

// getSetting reads one settings row; missing means "".
func (s *Service) getSetting(ctx context.Context, key string) string {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.log.WarnContext(ctx, "ingest: setting load failed", "key", key, "err", err)
	}
	return value
}

// setSetting upserts one settings row (v1 setSetting).
func (s *Service) setSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
		key, value)
	if err != nil {
		return err
	}
	return nil
}

// globalOrganizePattern is the fallback pattern for libraries without their
// own (v1 getOrganizePattern).
func (s *Service) globalOrganizePattern(ctx context.Context) string {
	if pattern := s.getSetting(ctx, settingOrganizePattern); pattern != "" {
		return pattern
	}
	return library.DefaultOrganizePattern
}

// settingsDuplicateStrategy returns the configured strategy, or "" when the
// setting is absent or invalid (the caller then falls back to the v1
// default). v1 stored an invalid value read as the default; treating it as
// unset keeps the payload override decision in one place.
func (s *Service) settingsDuplicateStrategy(ctx context.Context) Strategy {
	if raw := s.getSetting(ctx, settingDuplicateStrategy); IsStrategy(raw) {
		return Strategy(raw)
	}
	return ""
}

// reviewRetentionDays ports v1's getReviewRetentionDays: the settings value
// wins when it parses inside 1–365; anything else falls back to the
// configured default (itself clamped, like v1's zod bounds).
func (s *Service) reviewRetentionDays(ctx context.Context) int {
	if raw := s.getSetting(ctx, settingReviewRetention); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= reviewRetentionMin && parsed <= reviewRetentionMax {
			return parsed
		}
	}
	return s.retention
}
