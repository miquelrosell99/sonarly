import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../../src/db/migrate.js';
import { ScanScheduler, IngestScheduler } from '../../../src/features/library/scheduler.js';
import { popPendingJob, pushJob } from '../../../src/features/library/queue.js';
import type { Config } from '../../../src/config.js';

describe('ScanScheduler', () => {
  let db: Database.Database;
  let root: string;
  let config: Config;

  beforeEach(() => {
    root = join(tmpdir(), `sonarly-scheduler-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    config = {
      PORT: 3000,
      NODE_ENV: 'test',
      SESSION_SECRET: 'a'.repeat(32),
      USE_CRYPTO: false,
      DATA_DIR: root,
      LIBRARY_PATH: join(root, 'library'),
      INGEST_PATH: join(root, 'ingest'),
      ORGANIZE_PATTERN: '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}',
      SCAN_INTERVAL_MINUTES: 60,
      ARTIST_IMAGE_INTERVAL_MINUTES: 1440,
      INGEST_INTERVAL_MINUTES: 60,
      REVIEW_RETENTION_DAYS: 30,
      WATCHER_USE_POLLING: false,
      PUID: 1000,
      PGID: 1000,
    };
    mkdirSync(config.LIBRARY_PATH, { recursive: true });
    db = new Database(join(root, 'sonarly.db'));
    migrate(db);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('records the first tick as the baseline without queuing a scan', () => {
    const scheduler = new ScanScheduler(config);
    scheduler.tick(db, 1_000_000);

    const job = popPendingJob(db);
    expect(job).toBeUndefined();

    const last = db.prepare("SELECT value FROM settings WHERE key = 'last_periodic_scan'").pluck().get() as string;
    expect(last).toBe(new Date(1_000_000).toISOString());
  });

  it('does not queue a scan before the interval has elapsed', () => {
    const scheduler = new ScanScheduler(config);
    scheduler.tick(db, 0);
    scheduler.tick(db, 60 * 60 * 1000 - 1);

    const job = popPendingJob(db);
    expect(job).toBeUndefined();
  });

  it('queues a scan once the interval has elapsed', () => {
    const scheduler = new ScanScheduler(config);
    scheduler.tick(db, 0);
    scheduler.tick(db, 60 * 60 * 1000);

    const job = popPendingJob(db);
    expect(job).toBeDefined();
    expect(job?.type).toBe('scan');
  });

  function countPendingScans(): number {
    return db.prepare(
      "SELECT COUNT(*) FROM scan_jobs WHERE type = 'scan' AND status = 'pending'"
    ).pluck().get() as number;
  }

  it('does not queue overlapping scans when one is already pending', () => {
    const scheduler = new ScanScheduler(config);
    scheduler.tick(db, 0);
    scheduler.tick(db, 60 * 60 * 1000);

    expect(countPendingScans()).toBe(1);

    scheduler.tick(db, 60 * 60 * 1000 + 1);

    expect(countPendingScans()).toBe(1);
  });

  it('does not queue scans when disabled via SCAN_INTERVAL_MINUTES = 0', () => {
    const disabledConfig = { ...config, SCAN_INTERVAL_MINUTES: 0 };
    const scheduler = new ScanScheduler(disabledConfig);
    scheduler.tick(db, 0);
    scheduler.tick(db, Number.MAX_SAFE_INTEGER);

    const job = popPendingJob(db);
    expect(job).toBeUndefined();
  });

  it('queues another scan once the interval elapses again and the previous scan finished', () => {
    const scheduler = new ScanScheduler(config);
    scheduler.tick(db, 0);
    scheduler.tick(db, 60 * 60 * 1000);
    expect(countPendingScans()).toBe(1);

    db.prepare("UPDATE scan_jobs SET status = 'completed'").run();

    scheduler.tick(db, 2 * 60 * 60 * 1000);
    expect(countPendingScans()).toBe(1);

    const job = popPendingJob(db);
    expect(job).toBeDefined();
    expect(job?.type).toBe('scan');
  });
});

describe('IngestScheduler', () => {
  let db: Database.Database;
  let root: string;
  let config: Config;

  beforeEach(() => {
    root = join(tmpdir(), `sonarly-ingest-scheduler-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    config = {
      PORT: 3000,
      NODE_ENV: 'test',
      SESSION_SECRET: 'a'.repeat(32),
      USE_CRYPTO: false,
      DATA_DIR: root,
      LIBRARY_PATH: join(root, 'library'),
      INGEST_PATH: join(root, 'ingest'),
      ORGANIZE_PATTERN: '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}',
      SCAN_INTERVAL_MINUTES: 60,
      ARTIST_IMAGE_INTERVAL_MINUTES: 1440,
      INGEST_INTERVAL_MINUTES: 60,
      REVIEW_RETENTION_DAYS: 30,
      WATCHER_USE_POLLING: false,
      PUID: 1000,
      PGID: 1000,
    };
    mkdirSync(config.LIBRARY_PATH, { recursive: true });
    mkdirSync(config.INGEST_PATH, { recursive: true });
    db = new Database(join(root, 'sonarly.db'));
    migrate(db);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  function countPendingIngests(): number {
    return db.prepare(
      "SELECT COUNT(*) FROM scan_jobs WHERE type = 'ingest' AND status = 'pending'"
    ).pluck().get() as number;
  }

  it('records the first tick as the baseline without queuing an ingest', () => {
    const scheduler = new IngestScheduler(config);
    scheduler.tick(db, 1_000_000);

    expect(countPendingIngests()).toBe(0);

    const last = db.prepare("SELECT value FROM settings WHERE key = 'last_periodic_ingest'").pluck().get() as string;
    expect(last).toBe(new Date(1_000_000).toISOString());
  });

  it('queues an ingest once the interval has elapsed', () => {
    const scheduler = new IngestScheduler(config);
    scheduler.tick(db, 0);
    scheduler.tick(db, 60 * 60 * 1000);

    const job = popPendingJob(db);
    expect(job).toBeDefined();
    expect(job?.type).toBe('ingest');
    expect(job?.payload).toBe(config.INGEST_PATH);
  });

  it('does not queue overlapping ingests when one is already pending', () => {
    const scheduler = new IngestScheduler(config);
    scheduler.tick(db, 0);
    scheduler.tick(db, 60 * 60 * 1000);

    expect(countPendingIngests()).toBe(1);

    scheduler.tick(db, 60 * 60 * 1000 + 1);

    expect(countPendingIngests()).toBe(1);
  });

  it('does not queue ingests when disabled via INGEST_INTERVAL_MINUTES = 0', () => {
    const disabledConfig = { ...config, INGEST_INTERVAL_MINUTES: 0 };
    const scheduler = new IngestScheduler(disabledConfig);
    scheduler.tick(db, 0);
    scheduler.tick(db, Number.MAX_SAFE_INTEGER);

    const job = popPendingJob(db);
    expect(job).toBeUndefined();
  });
});
