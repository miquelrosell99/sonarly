import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { migrate } from '../../src/db/migrate.js';
import { getSetting, setSetting, getOrganizePattern } from '../../src/db/repositories/settings-repository.js';
import type { Config } from '../../src/config.js';

const baseConfig: Config = {
  PORT: 3000,
  NODE_ENV: 'test',
  SESSION_SECRET: 'a'.repeat(32),
  USE_CRYPTO: false,
  DATA_DIR: '/data',
  LIBRARY_PATH: '/data/library',
  INGEST_PATH: '/data/ingest',
  ORGANIZE_PATTERN: '{artist}/{album}/{track:00} - {title}{ext}',
  SCAN_INTERVAL_MINUTES: 60,
  REVIEW_RETENTION_DAYS: 30,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

describe('settings repository', () => {
  let root: string;
  let db: Database.Database;

  beforeEach(() => {
    root = join(tmpdir(), `sonarly-settings-repo-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    db = new Database(join(root, 'sonarly.db'));
    migrate(db);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the default for missing keys', () => {
    expect(getSetting(db, 'missing', 'default')).toBe('default');
  });

  it('stores and retrieves a value', () => {
    setSetting(db, 'organize_pattern', '{artist}/{title}{ext}');
    expect(getSetting(db, 'organize_pattern', '')).toBe('{artist}/{title}{ext}');
  });

  it('overwrites existing values', () => {
    setSetting(db, 'organize_pattern', 'a');
    setSetting(db, 'organize_pattern', 'b');
    expect(getSetting(db, 'organize_pattern', '')).toBe('b');
  });

  it('falls back to config for organize pattern', () => {
    expect(getOrganizePattern(db, baseConfig)).toBe(baseConfig.ORGANIZE_PATTERN);
    setSetting(db, 'organize_pattern', '{albumArtist}/{album}/{title}{ext}');
    expect(getOrganizePattern(db, baseConfig)).toBe('{albumArtist}/{album}/{title}{ext}');
  });
});
