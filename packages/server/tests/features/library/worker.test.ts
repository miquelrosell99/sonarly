import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushJob } from '../../../src/features/library/queue.js';
import { migrate } from '../../../src/db/migrate.js';
import type { Config } from '../../../src/config.js';
import NodeID3 from 'node-id3';

const workerUrl = new URL('../../../dist/features/library/worker.js', import.meta.url);
const fixture = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;

// Minimal 1x1 transparent PNG used to trigger the cover-art sync path.
const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function createMp3WithCover(targetPath: string): void {
  copyFileSync(fixture, targetPath);
  NodeID3.write(
    {
      title: 'Song With Cover',
      APIC: {
        mime: 'image/png',
        type: { id: 3, name: 'front cover' },
        description: 'cover',
        imageBuffer: MINI_PNG,
      },
    },
    targetPath
  );
}

function buildProject(): void {
  execSync('npm run build', {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    stdio: 'ignore',
  });
}

function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

describe('scanner worker thread', () => {
  beforeAll(buildProject);

  let root: string;
  let dbPath: string;
  let libraryPath: string;
  let ingestPath: string;
  let config: Config;
  let db: Database.Database;
  let worker: Worker;

  beforeEach(() => {
    root = join(tmpdir(), `sonarly-worker-${Date.now()}`);
    dbPath = join(root, 'sonarly.db');
    libraryPath = join(root, 'library');
    ingestPath = join(root, 'ingest');
    mkdirSync(libraryPath, { recursive: true });
    mkdirSync(ingestPath, { recursive: true });

    config = {
      PORT: 3000,
      NODE_ENV: 'test',
      SESSION_SECRET: 'a'.repeat(32),
      USE_CRYPTO: false,
      DATA_DIR: root,
      LIBRARY_PATH: libraryPath,
      INGEST_PATH: ingestPath,
      ORGANIZE_PATTERN: '{artist}/{album}/{title}',
      SCAN_INTERVAL_MINUTES: 60,
      REVIEW_RETENTION_DAYS: 30,
      WATCHER_USE_POLLING: false,
      PUID: 1000,
      PGID: 1000,
    };

    db = new Database(dbPath);
    migrate(db);
    worker = new Worker(workerUrl, { workerData: config });
  });

  afterEach(async () => {
    if (worker) {
      await new Promise<void>((resolve) => {
        worker.once('exit', () => resolve());
        worker.postMessage({ type: 'shutdown' });
      });
    }
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('processes a scan job using workerData config', async () => {
    copyFileSync(fixture, join(libraryPath, 'Song.mp3'));

    pushJob(db, 'scan', libraryPath);

    await waitFor(() => {
      const row = db.prepare("SELECT status, stats FROM scan_jobs WHERE type = 'scan'").get() as any;
      return row?.status === 'completed' && row?.stats && JSON.parse(row.stats).scanned === 1;
    });

    const row = db.prepare("SELECT status, stats FROM scan_jobs WHERE type = 'scan'").get() as any;
    expect(row.status).toBe('completed');
    const stats = JSON.parse(row.stats);
    expect(stats.scanned).toBe(1);
    expect(stats.added).toBe(1);
  });

  it('registers tag writers in the worker so cover-art sync does not fail', async () => {
    createMp3WithCover(join(libraryPath, 'SongWithCover.mp3'));

    pushJob(db, 'scan', libraryPath);

    await waitFor(() => {
      const row = db.prepare("SELECT status, stats FROM scan_jobs WHERE type = 'scan'").get() as any;
      return row?.status === 'completed' && row?.stats && JSON.parse(row.stats).scanned === 1;
    });

    const row = db.prepare("SELECT status, stats FROM scan_jobs WHERE type = 'scan'").get() as any;
    expect(row.status).toBe('completed');
    const stats = JSON.parse(row.stats);
    expect(stats.scanned).toBe(1);
    expect(stats.added).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it('processes an ingest job', async () => {
    pushJob(db, 'ingest', ingestPath);

    await waitFor(() => {
      const row = db.prepare("SELECT status FROM scan_jobs WHERE type = 'ingest'").get() as any;
      return row?.status === 'completed';
    });

    const row = db.prepare("SELECT status, stats FROM scan_jobs WHERE type = 'ingest'").get() as any;
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.stats)).toEqual({ processed: 0, imported: 0, needsReview: 0, failed: 0 });
  });

  it('processes an organize job', async () => {
    copyFileSync(fixture, join(libraryPath, 'loose.mp3'));

    pushJob(db, 'organize', '');

    await waitFor(() => {
      const row = db.prepare("SELECT status, stats FROM scan_jobs WHERE type = 'organize'").get() as any;
      return row?.status === 'completed' && row?.stats && JSON.parse(row.stats).moved === 1;
    });

    const row = db.prepare("SELECT status, stats FROM scan_jobs WHERE type = 'organize'").get() as any;
    expect(row.status).toBe('completed');
    const stats = JSON.parse(row.stats);
    expect(stats.total).toBe(1);
    expect(stats.moved).toBe(1);
  });

});
