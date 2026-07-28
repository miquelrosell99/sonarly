import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import type { DuplicateStrategy } from '@sonarly/shared';
import { isDuplicateStrategy } from '@sonarly/shared';

export function getSetting(db: Database.Database, key: string, defaultValue: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key) as string | undefined;
  return row ?? defaultValue;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ).run(key, value);
}

export function getReviewRetentionDays(db: Database.Database, defaultValue: number): number {
  const raw = getSetting(db, 'review_retention_days', String(defaultValue));
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 365) return defaultValue;
  return parsed;
}

const DEFAULT_ORGANIZE_PATTERN = '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}';

export function getOrganizePattern(db: Database.Database, config: Config): string {
  return getSetting(db, 'organize_pattern', config.ORGANIZE_PATTERN ?? DEFAULT_ORGANIZE_PATTERN);
}

export const DEFAULT_DUPLICATE_STRATEGY: DuplicateStrategy = 'keep_file_replace_metadata';

export function getDuplicateStrategy(db: Database.Database): DuplicateStrategy {
  const raw = getSetting(db, 'duplicate_strategy', DEFAULT_DUPLICATE_STRATEGY);
  return isDuplicateStrategy(raw) ? raw : DEFAULT_DUPLICATE_STRATEGY;
}

export function setDuplicateStrategy(db: Database.Database, strategy: DuplicateStrategy): void {
  setSetting(db, 'duplicate_strategy', strategy);
}
