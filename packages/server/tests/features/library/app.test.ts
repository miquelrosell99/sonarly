import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import type { Config } from '../../../src/config.js';

vi.mock('node:worker_threads', () => {
  class MockWorker {
    postMessage = vi.fn();
    on = vi.fn();
    once = vi.fn((event: string, cb: () => void) => {
      if (event === 'exit') {
        this.threadId = -1;
        cb();
      }
    });
    terminate = vi.fn().mockResolvedValue(undefined);
    threadId = 1;
  }
  return {
    Worker: vi.fn().mockImplementation(() => new MockWorker()),
    workerData: {},
    parentPort: null,
  };
});

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

describe('buildApp', () => {
  let root: string;
  let config: Config;
  let db: Database.Database;

  beforeEach(() => {
    root = join(tmpdir(), `sonarly-app-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    config = {
      ...baseConfig,
      DATA_DIR: root,
      LIBRARY_PATH: join(root, 'library'),
      INGEST_PATH: join(root, 'ingest'),
    };
    mkdirSync(config.LIBRARY_PATH, { recursive: true });
    mkdirSync(config.INGEST_PATH, { recursive: true });
    db = new Database(join(root, 'sonarly.db'));
    migrate(db);
  });

  afterEach(() => {
    try { db.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  });

  it('returns a fastify app, pushes an initial scan job, and registers an onClose hook', async () => {
    const { Worker } = await import('node:worker_threads');

    const app = await buildApp(config, db);

    expect(app).toBeDefined();
    expect(Worker).toHaveBeenCalledTimes(1);

    const workerInstance = (Worker as any).mock.results[0].value;
    expect(workerInstance.postMessage).not.toHaveBeenCalled();

    const checkDb = new Database(join(root, 'sonarly.db'));
    const job = checkDb.prepare("SELECT type, stats FROM scan_jobs WHERE type = 'scan'").get() as any;
    expect(job).toBeDefined();
    expect(JSON.parse(job.stats).path).toBe(config.LIBRARY_PATH);
    checkDb.close();

    await app.close();
    expect(workerInstance.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
  });
});
