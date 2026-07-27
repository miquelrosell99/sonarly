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
  ARTIST_IMAGE_INTERVAL_MINUTES: 1440,
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

  it('creates users with transcoding settings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
      payload: { username: 'carol', password: 'carolpass', maxBitrateKbps: 192, transcodeFormat: 'opus' },
    });
    expect(res.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    const carol = JSON.parse(list.body).users.find((u: { username: string }) => u.username === 'carol');
    expect(carol.maxBitrateKbps).toBe(192);
    expect(carol.transcodeFormat).toBe('opus');
  });

  it('updates user transcoding settings', async () => {
    const bobId = 'user-bob';
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${bobId}`,
      cookies: { sessionId: adminCookie },
      payload: { maxBitrateKbps: 128, transcodeFormat: 'mp3' },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    const bob = JSON.parse(list.body).users.find((u: { username: string }) => u.username === 'bob');
    expect(bob.maxBitrateKbps).toBe(128);
    expect(bob.transcodeFormat).toBe('mp3');
  });

  it('rejects invalid transcoding settings', async () => {
    const bobId = 'user-bob';
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${bobId}`,
      cookies: { sessionId: adminCookie },
      payload: { maxBitrateKbps: 10, transcodeFormat: 'flac' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('updates user role', async () => {
    const bobId = 'user-bob';
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${bobId}`,
      cookies: { sessionId: adminCookie },
      payload: { isAdmin: true },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    const bob = JSON.parse(list.body).users.find((u: { username: string }) => u.username === 'bob');
    expect(bob.isAdmin).toBe(true);
  });

  it('prevents removing the last admin', async () => {
    const adminId = 'user-admin';
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${adminId}`,
      cookies: { sessionId: adminCookie },
      payload: { isAdmin: false },
    });
    expect(res.statusCode).toBe(409);
  });

  it('updates user profile fields', async () => {
    const bobId = 'user-bob';
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${bobId}`,
      cookies: { sessionId: adminCookie },
      payload: { name: 'Bob', surname: 'Smith', email: 'bob@example.com' },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    const bob = JSON.parse(list.body).users.find((u: { username: string }) => u.username === 'bob');
    expect(bob.name).toBe('Bob');
    expect(bob.surname).toBe('Smith');
    expect(bob.email).toBe('bob@example.com');
  });

  it('updates user password', async () => {
    const bobId = 'user-bob';
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${bobId}`,
      cookies: { sessionId: adminCookie },
      payload: { password: 'newbobpass' },
    });
    expect(res.statusCode).toBe(200);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'bob', password: 'newbobpass' },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it('creates users with profile fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
      payload: {
        username: 'carol',
        password: 'carolpass',
        name: 'Carol',
        surname: 'Doe',
        email: 'carol@example.com',
      },
    });
    expect(res.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    const carol = JSON.parse(list.body).users.find((u: { username: string }) => u.username === 'carol');
    expect(carol.name).toBe('Carol');
    expect(carol.surname).toBe('Doe');
    expect(carol.email).toBe('carol@example.com');
  });

  it('deletes a user', async () => {
    const bobId = 'user-bob';
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${bobId}`,
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    expect(JSON.parse(list.body).users).toHaveLength(1);
  });

  it('forbids deleting self', async () => {
    const adminId = 'user-admin';
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${adminId}`,
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(409);
  });

  it('allows deleting an admin when another admin remains', async () => {
    const carolId = await seedUser(db, 'carol', 'carolpass', true);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${carolId}`,
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { sessionId: adminCookie },
    });
    const usernames = JSON.parse(list.body).users.map((u: { username: string }) => u.username).sort();
    expect(usernames).toEqual(['admin', 'bob']);
  });

  it('forbids user deletion for non-admins', async () => {
    const bobId = 'user-bob';
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${bobId}`,
      cookies: { sessionId: userCookie },
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
    expect(body.latestIngest).toBeNull();
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

  describe('system tasks', () => {
    it('returns system tasks for admins', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/system-tasks',
        cookies: { sessionId: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tasks).toBeInstanceOf(Array);
      expect(body.tasks.length).toBe(3);
      expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(['periodic_scan', 'review_cleanup', 'artist_images']);
      for (const task of body.tasks) {
        expect(task).toHaveProperty('name');
        expect(task).toHaveProperty('description');
        expect(task).toHaveProperty('intervalMinutes');
        expect(task).toHaveProperty('lastRunAt');
        expect(task).toHaveProperty('status');
      }
    });

    it('reflects the latest job status and finish time', async () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO scan_jobs (id, type, status, started_at, finished_at) VALUES (?, 'scan', 'completed', ?, ?)"
      ).run('scan-1', now, now);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/system-tasks',
        cookies: { sessionId: adminCookie },
      });
      const scanTask = JSON.parse(res.body).tasks.find((t: { id: string }) => t.id === 'periodic_scan');
      expect(scanTask.status).toBe('completed');
      expect(scanTask.lastRunAt).toBe(now);
    });

    it('queues a periodic scan when run', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/system-tasks/periodic_scan/run',
        cookies: { sessionId: adminCookie },
      });
      expect(res.statusCode).toBe(202);

      const pending = db.prepare("SELECT * FROM scan_jobs WHERE type = 'scan' AND status = 'pending'").all();
      expect(pending.length).toBeGreaterThan(0);
    });

    it('queues a review cleanup when run', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/system-tasks/review_cleanup/run',
        cookies: { sessionId: adminCookie },
      });
      expect(res.statusCode).toBe(202);

      const pending = db
        .prepare("SELECT * FROM scan_jobs WHERE type = 'cleanup_review' AND status = 'pending'")
        .all();
      expect(pending.length).toBeGreaterThan(0);
    });

    it('queues an artist image sync when run', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/system-tasks/artist_images/run',
        cookies: { sessionId: adminCookie },
      });
      expect(res.statusCode).toBe(202);

      const pending = db
        .prepare("SELECT * FROM scan_jobs WHERE type = 'artist_images' AND status = 'pending'")
        .all();
      expect(pending.length).toBeGreaterThan(0);
    });

    it('returns system task history for admins', async () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO scan_jobs (id, type, status, started_at, finished_at, stats) VALUES (?, 'scan', 'completed', ?, ?, ?)"
      ).run('history-1', now, now, JSON.stringify({ added: 5, updated: 2 }));

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/system-tasks/history',
        cookies: { sessionId: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.history).toBeInstanceOf(Array);
      expect(body.history.length).toBeGreaterThan(0);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(10);
      expect(body.total).toBeGreaterThan(0);
      expect(body.totalPages).toBeGreaterThan(0);
      const item = body.history.find((h: { id: string }) => h.id === 'history-1');
      expect(item).toBeDefined();
      expect(item.task).toBe('Periodic library scan');
      expect(item.status).toBe('completed');
      expect(item.stats).toMatchObject({ added: 5, updated: 2 });
    });

    it('paginates history', async () => {
      const now = new Date().toISOString();
      for (let i = 0; i < 12; i++) {
        db.prepare(
          "INSERT INTO scan_jobs (id, type, status, started_at, finished_at) VALUES (?, 'scan', 'completed', ?, ?)"
        ).run(`paginated-${i}`, now, now);
      }

      const first = await app.inject({
        method: 'GET',
        url: '/api/admin/system-tasks/history?page=1&limit=10',
        cookies: { sessionId: adminCookie },
      });
      expect(first.statusCode).toBe(200);
      const firstBody = JSON.parse(first.body);
      expect(firstBody.history.length).toBe(10);
      expect(firstBody.total).toBeGreaterThanOrEqual(12);
      expect(firstBody.totalPages).toBeGreaterThanOrEqual(2);

      const second = await app.inject({
        method: 'GET',
        url: '/api/admin/system-tasks/history?page=2&limit=10',
        cookies: { sessionId: adminCookie },
      });
      expect(second.statusCode).toBe(200);
      const secondBody = JSON.parse(second.body);
      expect(secondBody.page).toBe(2);
      expect(secondBody.history.length).toBeGreaterThan(0);
    });

    it('forbids history for non-admins', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/system-tasks/history',
        cookies: { sessionId: userCookie },
      });
      expect(res.statusCode).toBe(403);
    });

    it('requires authentication for history', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/system-tasks/history' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid task ids', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/system-tasks/unknown/run',
        cookies: { sessionId: adminCookie },
      });
      expect(res.statusCode).toBe(400);
    });

    it('forbids non-admins', async () => {
      const get = await app.inject({
        method: 'GET',
        url: '/api/admin/system-tasks',
        cookies: { sessionId: userCookie },
      });
      expect(get.statusCode).toBe(403);

      const post = await app.inject({
        method: 'POST',
        url: '/api/admin/system-tasks/periodic_scan/run',
        cookies: { sessionId: userCookie },
      });
      expect(post.statusCode).toBe(403);
    });

    it('requires authentication', async () => {
      const get = await app.inject({ method: 'GET', url: '/api/admin/system-tasks' });
      expect(get.statusCode).toBe(401);

      const post = await app.inject({ method: 'POST', url: '/api/admin/system-tasks/periodic_scan/run' });
      expect(post.statusCode).toBe(401);
    });
  });
});
