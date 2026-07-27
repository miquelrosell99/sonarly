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

async function seedAdminUser(db: Database.Database) {
  const passwordHash = await hashPassword('adminpass');
  const subsonicPasswordEncrypted = encryptSubsonicPassword('adminpass', baseConfig.SESSION_SECRET);
  createUser(db, {
    id: 'admin-1',
    username: 'admin',
    passwordHash,
    subsonicPasswordEncrypted,
    isAdmin: true,
    createdAt: new Date().toISOString(),
  });
}

describe('management auth endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-auth-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    config = {
      ...baseConfig,
      DATA_DIR: root,
      LIBRARY_PATH: join(root, 'library'),
      INGEST_PATH: join(root, 'ingest'),
    };
    mkdirSync(config.LIBRARY_PATH, { recursive: true });
    mkdirSync(config.INGEST_PATH, { recursive: true });
    const db = new Database(join(root, 'sonarly.db'));
    await migrate(db);
    await seedAdminUser(db);
    app = await buildApp(config, db);
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns needsSetup false when users exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/setup' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ needsSetup: false });
  });

  it('logs in and returns the user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'adminpass' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user).toMatchObject({ id: 'admin-1', username: 'admin', isAdmin: true });
    expect(res.cookies).toBeDefined();
  });

  it('rejects invalid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns me when authenticated', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'adminpass' },
    });
    const cookie = login.cookies.find((c) => c.name === 'sessionId');
    expect(cookie).toBeDefined();

    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { sessionId: cookie!.value },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).user).toMatchObject({ id: 'admin-1', username: 'admin', isAdmin: true });
  });

  it('returns 401 for me when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('logs out and destroys the session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'adminpass' },
    });
    const cookie = login.cookies.find((c) => c.name === 'sessionId');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { sessionId: cookie!.value },
    });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { sessionId: cookie!.value },
    });
    expect(me.statusCode).toBe(401);
  });

  it('completes setup for an empty database', async () => {
    const emptyRoot = join(tmpdir(), `sonarly-management-setup-${Date.now()}`);
    mkdirSync(emptyRoot, { recursive: true });
    const emptyConfig = {
      ...baseConfig,
      DATA_DIR: emptyRoot,
      LIBRARY_PATH: join(emptyRoot, 'library'),
      INGEST_PATH: join(emptyRoot, 'ingest'),
    };
    mkdirSync(emptyConfig.LIBRARY_PATH, { recursive: true });
    mkdirSync(emptyConfig.INGEST_PATH, { recursive: true });
    const db = new Database(join(emptyRoot, 'sonarly.db'));
    await migrate(db);
    const emptyApp = await buildApp(emptyConfig, db);

    const setupCheck = await emptyApp.inject({ method: 'GET', url: '/api/setup' });
    expect(JSON.parse(setupCheck.body)).toEqual({ needsSetup: true });

    const setup = await emptyApp.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { username: 'first', password: 'firstpass', name: 'Ada', surname: 'Lovelace', email: 'ada@example.com' },
    });
    expect(setup.statusCode).toBe(201);
    const body = JSON.parse(setup.body);
    expect(body.user).toMatchObject({
      username: 'first',
      isAdmin: true,
      name: 'Ada',
      surname: 'Lovelace',
      email: 'ada@example.com',
    });

    const me = await emptyApp.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { sessionId: setup.cookies.find((c) => c.name === 'sessionId')!.value },
    });
    expect(me.statusCode).toBe(200);

    const repeated = await emptyApp.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { username: 'second', password: 'secondpass' },
    });
    expect(repeated.statusCode).toBe(403);

    await emptyApp.close();
    rmSync(emptyRoot, { recursive: true, force: true });
  });

  it('blocks protected routes without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scans/status' });
    expect(res.statusCode).toBe(401);
  });
});
