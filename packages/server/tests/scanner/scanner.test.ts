import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync, copyFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/db/migrate.js';
import { scanLibrary } from '../../src/scanner/scanner.js';
import type { Config } from '../../src/config.js';

const fixture = new URL('../fixtures/sample.mp3', import.meta.url).pathname;

describe('scanLibrary', () => {
  let db: Database.Database;
  let libraryPath: string;
  let config: Config;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    libraryPath = join(tmpdir(), `sonarly-scan-${Date.now()}`);
    mkdirSync(libraryPath, { recursive: true });
    config = {
      PORT: 3000,
      NODE_ENV: 'test',
      SESSION_SECRET: 'a'.repeat(32),
      DATA_DIR: '/data',
      LIBRARY_PATH: libraryPath,
      INGEST_PATH: '/data/ingest',
      SCAN_INTERVAL_MINUTES: 60,
      WATCHER_USE_POLLING: false,
      PUID: 1000,
      PGID: 1000,
    };
  });

  afterEach(() => {
    db.close();
    rmSync(libraryPath, { recursive: true, force: true });
  });

  it('adds a new audio file to the database', async () => {
    const target = join(libraryPath, 'Artist', 'Album', 'Song.mp3');
    mkdirSync(join(libraryPath, 'Artist', 'Album'), { recursive: true });
    copyFileSync(fixture, target);

    const stats = await scanLibrary(config, db);

    expect(stats.scanned).toBe(1);
    expect(stats.added).toBe(1);
    expect(stats.failed).toBe(0);
    const row = db.prepare('SELECT * FROM songs WHERE file_path = ?').get(target) as any;
    expect(row).toBeDefined();
    expect(row.title).toBe('Sample Song');
    expect(row.artist_id).toBeDefined();
    expect(row.album_id).toBeDefined();
  });

  it('skips unchanged files on rescan', async () => {
    const target = join(libraryPath, 'Song.mp3');
    copyFileSync(fixture, target);
    await scanLibrary(config, db);

    const stats = await scanLibrary(config, db);

    expect(stats.scanned).toBe(1);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
  });

  it('updates a file when its mtime changes', async () => {
    const target = join(libraryPath, 'Song.mp3');
    copyFileSync(fixture, target);
    await scanLibrary(config, db);
    const before = db.prepare('SELECT mtime FROM songs WHERE file_path = ?').pluck().get(target) as number;

    const future = Date.now() + 60_000;
    utimesSync(target, future / 1000, future / 1000);
    const stats = await scanLibrary(config, db);

    expect(stats.updated).toBe(1);
    const after = db.prepare('SELECT mtime FROM songs WHERE file_path = ?').pluck().get(target) as number;
    expect(after).toBeGreaterThan(before);
  });

  it('detects moved files by checksum and preserves the song id', async () => {
    const oldPath = join(libraryPath, 'Old', 'Song.mp3');
    const newPath = join(libraryPath, 'New', 'Song.mp3');
    mkdirSync(join(libraryPath, 'Old'), { recursive: true });
    mkdirSync(join(libraryPath, 'New'), { recursive: true });
    copyFileSync(fixture, oldPath);
    await scanLibrary(config, db);
    const beforeId = db.prepare('SELECT id FROM songs WHERE file_path = ?').pluck().get(oldPath) as string;

    rmSync(oldPath);
    copyFileSync(fixture, newPath);
    const stats = await scanLibrary(config, db);

    expect(stats.moved).toBe(1);
    expect(stats.removed).toBe(0);
    const afterId = db.prepare('SELECT id FROM songs WHERE file_path = ?').pluck().get(newPath) as string;
    expect(afterId).toBe(beforeId);
    const oldRow = db.prepare('SELECT * FROM songs WHERE file_path = ?').get(oldPath) as any;
    expect(oldRow).toBeUndefined();
  });

  it('removes database entries for files no longer on disk', async () => {
    const target = join(libraryPath, 'Song.mp3');
    copyFileSync(fixture, target);
    await scanLibrary(config, db);

    rmSync(target);
    const stats = await scanLibrary(config, db);

    expect(stats.removed).toBe(1);
    const row = db.prepare('SELECT * FROM songs WHERE file_path = ?').get(target) as any;
    expect(row).toBeUndefined();
  });

  it('ignores non-audio files', async () => {
    writeFileSync(join(libraryPath, 'notes.txt'), 'hello');
    const stats = await scanLibrary(config, db);

    expect(stats.scanned).toBe(0);
    expect(stats.added).toBe(0);
  });
});
