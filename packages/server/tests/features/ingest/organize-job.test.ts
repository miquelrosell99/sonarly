import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../../src/db/migrate.js';
import { runOrganizeJob, type OrganizeJobStats } from '../../../src/features/ingest/organize-job.js';
import { pushJob, markJobRunning } from '../../../src/features/library/queue.js';
import type { Config } from '../../../src/config.js';

const fixturePath = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;

describe('runOrganizeJob', () => {
  let db: Database.Database;
  let libraryPath: string;
  let config: Config;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    libraryPath = join(tmpdir(), `sonarly-organize-job-${randomUUID()}`);
    mkdirSync(libraryPath, { recursive: true });
    config = {
      PORT: 3000,
      DATA_DIR: '/data',
      LIBRARY_PATH: libraryPath,
      INGEST_PATH: '/data/ingest',
      ORGANIZE_PATTERN: '{artist}/{album}/{title}',
      SCAN_INTERVAL_MINUTES: 60,
      WATCHER_USE_POLLING: false,
      PUID: 1000,
      PGID: 1000,
      NODE_ENV: 'test',
      SESSION_SECRET: 'a'.repeat(32),
    };
  });

  afterEach(() => {
    db.close();
    rmSync(libraryPath, { recursive: true, force: true });
  });

  it('counts only files that need moving and tracks progress', async () => {
    const organizedDir = join(libraryPath, 'Sample Artist', 'Sample Album');
    mkdirSync(organizedDir, { recursive: true });
    copyFileSync(fixturePath, join(organizedDir, 'Sample Song.mp3'));
    copyFileSync(fixturePath, join(libraryPath, 'loose.mp3'));

    db.prepare("INSERT INTO songs (id, file_path, title, track_number, disc_number, duration, artist_id, album_id, genre, year, cover_art, mtime, checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run('song-1', join(libraryPath, 'loose.mp3'), 'Sample Song', null, null, null, null, null, null, null, null, 0, 'checksum');

    const jobId = pushJob(db, 'organize', '');
    markJobRunning(db, jobId);

    const stats = await runOrganizeJob(config, db, jobId);

    expect(stats.total).toBe(1);
    expect(stats.moved).toBe(1);
    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.done).toBe(1);

    const row = db.prepare('SELECT stats FROM scan_jobs WHERE id = ?').get(jobId) as any;
    const finalStats = JSON.parse(row.stats) as OrganizeJobStats;
    expect(finalStats.moved).toBe(1);
    expect(finalStats.done).toBe(1);
  });
});
