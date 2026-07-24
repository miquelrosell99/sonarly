import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { upsertAlbum } from '../../../src/features/albums/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';
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

async function seedUser(db: Database.Database, username: string, password: string, isAdmin = false) {
  const passwordHash = await hashPassword(password);
  const subsonicPasswordEncrypted = encryptSubsonicPassword(password, baseConfig.SESSION_SECRET);
  const id = `user-${username}`;
  createUser(db, {
    id,
    username,
    passwordHash,
    subsonicPasswordEncrypted,
    isAdmin,
    createdAt: new Date().toISOString(),
  });
  return id;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password },
  });
  const cookie = res.cookies.find((c) => c.name === 'sessionId');
  if (!cookie) throw new Error('Login failed');
  return cookie.value;
}

describe('management admin endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database.Database;
  let adminCookie: string;
  let userCookie: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-admin-${Date.now()}`);
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
    await seedUser(db, 'admin', 'adminpass', true);
    await seedUser(db, 'bob', 'bobpass', false);
    app = await buildApp(config, db);

    adminCookie = await login(app, 'admin', 'adminpass');
    userCookie = await login(app, 'bob', 'bobpass');
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists users for admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.users).toHaveLength(2);
    expect(body.users.map((u: { username: string }) => u.username).sort()).toEqual(['admin', 'bob']);
  });

  it('forbids user list for non-admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: userCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates users for admins', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
      payload: { username: 'carol', password: 'carolpass', isAdmin: false },
    });
    expect(res.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    expect(JSON.parse(list.body).users).toHaveLength(3);
  });

  it('forbids user creation for non-admins', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: { sessionId: userCookie },
      payload: { username: 'carol', password: 'carolpass' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns admin status for admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/status',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.counts).toMatchObject({ users: 2, songs: 0, albums: 0, artists: 0 });
    expect(body.latestScan).toMatchObject({ type: 'scan', status: 'pending' });
  });

  it('forbids admin status for non-admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/status',
      cookies: { sessionId: userCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists missing items for admins', async () => {
    upsertArtist(db, { id: 'artist-1', name: 'Gone Artist', active: false });
    upsertAlbum(db, { id: 'album-1', name: 'Gone Album', artistId: 'artist-1', artistName: 'Gone Artist', active: false });
    upsertSong(db, {
      id: 'song-1',
      filePath: '/data/library/gone.mp3',
      title: 'Gone Song',
      artistId: 'artist-1',
      albumId: 'album-1',
      mtime: Date.now(),
      checksum: 'checksum-1',
      active: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/missing',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.songs).toHaveLength(1);
    expect(body.songs[0].id).toBe('song-1');
    expect(body.albums).toHaveLength(1);
    expect(body.albums[0].id).toBe('album-1');
    expect(body.artists).toHaveLength(1);
    expect(body.artists[0].id).toBe('artist-1');
  });

  it('forbids missing items list for non-admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/missing',
      cookies: { sessionId: userCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows admins to purge a missing song', async () => {
    upsertSong(db, {
      id: 'song-1',
      filePath: '/data/library/gone.mp3',
      title: 'Gone Song',
      mtime: Date.now(),
      checksum: 'checksum-1',
      active: false,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/missing/songs/song-1',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const row = db.prepare('SELECT * FROM songs WHERE id = ?').get('song-1');
    expect(row).toBeUndefined();
  });
});
