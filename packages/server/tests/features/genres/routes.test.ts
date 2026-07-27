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
  ORGANIZE_PATTERN: '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}',
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

describe('genre management endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie: string;
  let userCookie: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-genres-${Date.now()}`);
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
      username: 'admin',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: true,
      createdAt: new Date().toISOString(),
    });
    createUser(db, {
      id: 'user-2',
      username: 'regular',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });

    db.prepare("INSERT INTO genres (id, name, parent_id, active) VALUES ('g1', 'Rock', NULL, 1), ('g2', 'Classic Rock', 'g1', 1)").run();

    app = await buildApp(config, db);

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'pass' },
    });
    adminCookie = adminLogin.cookies.find((c) => c.name === 'sessionId')!.value;

    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'regular', password: 'pass' },
    });
    userCookie = userLogin.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists genres with full paths', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/genres',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.genres).toHaveLength(2);
    const paths = body.genres.map((g: { path: string }) => g.path).sort();
    expect(paths).toEqual(['Rock', 'Rock > Classic Rock']);
  });

  it('returns the genre tree', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/genres/tree',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tree).toHaveLength(1);
    expect(body.tree[0].name).toBe('Rock');
    expect(body.tree[0].children).toHaveLength(1);
    expect(body.tree[0].children[0].name).toBe('Classic Rock');
  });

  it('creates a root genre for admins', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/genres',
      cookies: { sessionId: adminCookie },
      payload: { name: 'Jazz' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.genre.name).toBe('Jazz');
  });

  it('creates a child genre for admins', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/genres',
      cookies: { sessionId: adminCookie },
      payload: { name: 'Metal', parentId: 'g1' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.genre.name).toBe('Metal');
    expect(body.genre.parentId).toBe('g1');
  });

  it('rejects genre creation for non-admins', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/genres',
      cookies: { sessionId: userCookie },
      payload: { name: 'Jazz' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('renames a genre for admins', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/genres/g1',
      cookies: { sessionId: adminCookie },
      payload: { name: 'Rock Music' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.genre.name).toBe('Rock Music');
  });

  it('moves a genre to a new parent for admins', async () => {
    db.prepare("INSERT INTO genres (id, name, parent_id, active) VALUES ('g3', 'Punk', NULL, 1)").run();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/genres/g3',
      cookies: { sessionId: adminCookie },
      payload: { parentId: 'g2' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.genre.parentId).toBe('g2');
  });

  it('deletes a leaf genre for admins', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/genres/g2',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    const row = db.prepare('SELECT * FROM genres WHERE id = ?').get('g2') as { active: number } | undefined;
    expect(row).toBeUndefined();
  });

  it('prevents deleting a genre with children', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/genres/g1',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(409);
  });

  it('requires authentication for genre endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/genres',
    });
    expect(res.statusCode).toBe(401);
  });
});
