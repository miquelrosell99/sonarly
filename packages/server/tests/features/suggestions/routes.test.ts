import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';
import { upsertAlbum } from '../../../src/features/albums/repository.js';
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

describe('suggestion endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie: string;
  let userCookie: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-suggestions-${Date.now()}`);
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
    upsertArtist(db, { id: 'artist-1', name: 'Alpha Artist' });
    upsertArtist(db, { id: 'artist-2', name: 'Beta Artist' });
    upsertAlbum(db, { id: 'album-1', name: 'Alpha Album', artistName: 'Alpha Artist', genre: 'Rock' });
    upsertAlbum(db, { id: 'album-2', name: 'Beta Album', artistName: 'Beta Artist', genre: 'Pop' });
    db.prepare("INSERT INTO genres (id, name, active) VALUES ('genre-rock', 'Rock', 1), ('genre-pop', 'Pop', 1)").run();
    db.prepare("UPDATE albums SET genre_id = 'genre-rock' WHERE id = 'album-1'").run();
    db.prepare("UPDATE albums SET genre_id = 'genre-pop' WHERE id = 'album-2'").run();

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

  it('returns artist suggestions for admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/suggestions?field=artist&q=alp&limit=10',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.suggestions).toEqual(['Alpha Artist']);
  });

  it('returns album suggestions for admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/suggestions?field=album&q=beta',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).suggestions).toEqual(['Beta Album']);
  });

  it('returns albumArtist suggestions for admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/suggestions?field=albumArtist&q=artist',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).suggestions).toEqual(['Alpha Artist', 'Beta Artist']);
  });

  it('returns genre suggestions for admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/suggestions?field=genre&q=ro',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).suggestions).toEqual(['Rock']);
  });

  it('rejects unsupported fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/suggestions?field=unknown&q=x',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/suggestions?field=artist&q=alp',
      cookies: { sessionId: userCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/suggestions?field=artist&q=alp',
    });
    expect(res.statusCode).toBe(401);
  });
});
