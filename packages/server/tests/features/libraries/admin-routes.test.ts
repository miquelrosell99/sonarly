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

describe('library admin endpoints', () => {
  let root: string;
  let config: Config;
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-library-admin-${Date.now()}`);
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
      id: 'admin-1',
      username: 'admin',
      passwordHash: await hashPassword('adminpass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('adminpass', config.SESSION_SECRET),
      isAdmin: true,
      createdAt: new Date().toISOString(),
    });
    app = await buildApp(config, db);

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'adminpass' },
    });
    adminCookie = login.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists libraries including the default library', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.libraries).toHaveLength(1);
    expect(body.libraries[0].path).toBe(config.LIBRARY_PATH);
    expect(body.libraries[0].organizePattern).toBeDefined();
    expect(body.libraries[0].isDefault).toBe(true);
  });

  it('lists libraries publicly without admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/libraries',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.libraries).toHaveLength(1);
  });

  it('creates a library', async () => {
    const path = join(root, 'media', 'music');
    mkdirSync(path, { recursive: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
      payload: { name: 'Music', path, organizePattern: '{artist}/{title}' },
    });
    expect(res.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    const libraries = JSON.parse(list.body).libraries;
    expect(libraries).toHaveLength(2);
    const created = libraries.find((l: { name: string }) => l.name === 'Music');
    expect(created).toBeDefined();
    expect(created.organizePattern).toBe('{artist}/{title}');
    expect(created.isDefault).toBe(false);
  });

  it('creates a library as default and keeps a single default', async () => {
    const path = join(root, 'media', 'music2');
    mkdirSync(path, { recursive: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
      payload: { name: 'Music2', path, isDefault: true },
    });
    expect(res.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    const libraries = JSON.parse(list.body).libraries;
    const defaults = libraries.filter((l: { isDefault: boolean }) => l.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('Music2');
  });

  it('updates a library', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    const id = JSON.parse(list.body).libraries[0].id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/libraries/${id}`,
      cookies: { sessionId: adminCookie },
      payload: { name: 'Renamed', organizePattern: '{album}/{title}' },
    });
    expect(res.statusCode).toBe(200);

    const updated = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    const library = JSON.parse(updated.body).libraries[0];
    expect(library.name).toBe('Renamed');
    expect(library.organizePattern).toBe('{album}/{title}');
  });

  it('deletes a library', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    const id = JSON.parse(list.body).libraries[0].id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/libraries/${id}`,
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);

    const updated = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    expect(JSON.parse(updated.body).libraries).toHaveLength(0);
  });

  it('reassigns default when the default library is deleted', async () => {
    const path = join(root, 'media', 'secondary');
    mkdirSync(path, { recursive: true });
    await app.inject({
      method: 'POST',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
      payload: { name: 'Secondary', path },
    });

    const before = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    const libraries = JSON.parse(before.body).libraries;
    expect(libraries).toHaveLength(2);
    const defaultLibrary = libraries.find((l: { isDefault: boolean }) => l.isDefault);
    expect(defaultLibrary).toBeDefined();

    await app.inject({
      method: 'DELETE',
      url: `/api/admin/libraries/${defaultLibrary.id}`,
      cookies: { sessionId: adminCookie },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: adminCookie },
    });
    const remaining = JSON.parse(after.body).libraries;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].isDefault).toBe(true);
  });

  it('forbids non-admins', async () => {
    createUser(db, {
      id: 'user-1',
      username: 'user',
      passwordHash: await hashPassword('userpass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('userpass', config.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'user', password: 'userpass' },
    });
    const userCookie = login.cookies.find((c) => c.name === 'sessionId')!.value;

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/libraries',
      cookies: { sessionId: userCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
