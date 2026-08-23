import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../../src/db/migrate.js';
import { organizeExistingLibrary } from '../../../src/features/ingest/organize-existing.js';
import type { Config } from '../../../src/config.js';

const fixturePath = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;

describe('organizeExistingLibrary', () => {
  let db: Database.Database;
  let libraryPath: string;
  let config: Config;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    libraryPath = join(tmpdir(), `sonarly-lib-${randomUUID()}`);
    mkdirSync(libraryPath, { recursive: true });
    config = { PORT: 3000, DATA_DIR: '/data', LIBRARY_PATH: libraryPath, INGEST_PATH: '/data/ingest', ORGANIZE_PATTERN: '{artist}/{album}/{title}', SCAN_INTERVAL_MINUTES: 60, WATCHER_USE_POLLING: false, PUID: 1000, PGID: 1000, NODE_ENV: 'test', SESSION_SECRET: 'a'.repeat(32) };
  });

  afterEach(() => {
    db.close();
    rmSync(libraryPath, { recursive: true, force: true });
  });

  it('leaves already-organized files in place', async () => {
    const organizedDir = join(libraryPath, 'Sample Artist', 'Sample Album');
    mkdirSync(organizedDir, { recursive: true });
    copyFileSync(fixturePath, join(organizedDir, 'Sample Song.mp3'));
    const stats = await organizeExistingLibrary(config, db);
    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.moved).toBe(0);
  });

  it('moves unorganized files and updates the database', async () => {
    copyFileSync(fixturePath, join(libraryPath, 'sample.mp3'));
    db.prepare("INSERT INTO songs (id, file_path, title, track_number, disc_number, duration, artist_id, album_id, genre, year, mtime, checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run('song-1', join(libraryPath, 'sample.mp3'), 'Sample Song', null, null, null, null, null, null, null, 0, 'checksum');

    const stats = await organizeExistingLibrary(config, db);
    expect(stats.moved).toBe(1);

    const row = db.prepare('SELECT file_path FROM songs WHERE id = ?').get('song-1') as { file_path: string };
    expect(row.file_path).toBe(join(libraryPath, 'Sample Artist', 'Sample Album', 'Sample Song.mp3'));
  });

  it('removes empty directories left behind after moving files', async () => {
    const oldDir = join(libraryPath, 'Old Artist', 'Old Album');
    mkdirSync(oldDir, { recursive: true });
    copyFileSync(fixturePath, join(oldDir, 'Sample Song.mp3'));

    const stats = await organizeExistingLibrary(config, db);
    expect(stats.moved).toBe(1);
    expect(existsSync(oldDir)).toBe(false);
  });
});
