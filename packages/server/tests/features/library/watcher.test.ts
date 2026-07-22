import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../../src/db/migrate.js';
import { startLibraryWatcher, startIngestWatcher } from '../../../src/features/library/watcher.js';
import type { Config } from '../../../src/config.js';

const baseConfig: Config = {
  PORT: 3000,
  NODE_ENV: 'test',
  SESSION_SECRET: 'a'.repeat(32),
  USE_CRYPTO: false,
  DATA_DIR: '/data',
  LIBRARY_PATH: '/data/library',
  INGEST_PATH: '/data/ingest',
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: true,
  PUID: 1000,
  PGID: 1000,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('file watchers', () => {
  let db: Database.Database;
  let root: string;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    root = join(tmpdir(), `sonarly-watcher-${Date.now()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('library watcher schedules a resync job on file change', async () => {
    const libraryPath = join(root, 'library');
    mkdirSync(libraryPath, { recursive: true });
    const config = { ...baseConfig, LIBRARY_PATH: libraryPath };

    const stop = startLibraryWatcher(config, db);
    await wait(500);

    writeFileSync(join(libraryPath, 'new.mp3'), 'audio-data');
    await wait(2500);

    const job = db.prepare("SELECT type, stats FROM scan_jobs WHERE type = 'resync'").get() as any;
    expect(job).toBeDefined();
    expect(JSON.parse(job.stats).path).toBe(libraryPath);

    await stop();
  });

  it('ingest watcher schedules an ingest job on file add', async () => {
    const ingestPath = join(root, 'ingest');
    mkdirSync(ingestPath, { recursive: true });
    const config = { ...baseConfig, INGEST_PATH: ingestPath };

    const stop = startIngestWatcher(config, db);
    await wait(500);

    writeFileSync(join(ingestPath, 'track.mp3'), 'audio-data');
    await wait(2500);

    const job = db.prepare("SELECT type, stats FROM scan_jobs WHERE type = 'ingest'").get() as any;
    expect(job).toBeDefined();
    expect(JSON.parse(job.stats).path).toBe(ingestPath);

    await stop();
  });
});
