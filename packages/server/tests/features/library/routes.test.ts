import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
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
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

describe('management scan endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookieValue: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-scans-${Date.now()}`);
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
    createUser(db, {
      id: 'user-1',
      username: 'tester',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: true,
      createdAt: new Date().toISOString(),
    });

    app = await buildApp(config, db);
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'tester', password: 'pass' },
    });
    cookieValue = login.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('triggers a library scan', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const db = new Database(join(root, 'sonarly.db'));
    const jobs = db.prepare("SELECT * FROM scan_jobs WHERE type = 'scan'").all() as any[];
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs.some((j) => JSON.parse(j.stats).path === config.LIBRARY_PATH)).toBe(true);
    db.close();
  });

  it('returns the latest scan job', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/scans/status',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job).toBeDefined();
    expect(body.job.type).toBe('scan');
  });

  it('returns 403 for non-admin users when triggering a scan', async () => {
    createUser(db, {
      id: 'user-2',
      username: 'regular',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'regular', password: 'pass' },
    });
    const regularCookie = login.cookies.find((c) => c.name === 'sessionId')!.value;
    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      cookies: { sessionId: regularCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
