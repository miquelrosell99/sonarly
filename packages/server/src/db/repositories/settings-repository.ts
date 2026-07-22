import Database from 'better-sqlite3';
import type { Config } from '../../config.js';

export function getSetting(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ).run(key, value);
}

export function getOrganizePattern(db: Database.Database, config: Config): string {
  return getSetting(db, 'organize_pattern') ?? config.ORGANIZE_PATTERN;
}
