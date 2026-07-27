import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';
import { upsertAlbum } from '../../../src/features/albums/repository.js';
import { registerDefaultWriters } from '../../../src/features/tags/index.js';
import type { Config } from '../../../src/config.js';

registerDefaultWriters();

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

describe('management album endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookieValue: string;
  let tempDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-albums-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    tempDir = mkdtempSync(join(tmpdir(), 'sonarly-album-test-'));
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
    upsertArtist(db, { id: 'artist-1', name: 'Test Artist' });
    upsertAlbum(db, { id: 'album-1', name: 'Test Album', artistName: 'Test Artist' });

    const src = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;
    for (let i = 1; i <= 2; i++) {
      const filePath = join(config.LIBRARY_PATH, `song${i}.mp3`);
      copyFileSync(src, filePath);
      upsertSong(db, {
        id: `song-${i}`,
        filePath,
        title: `Old Title ${i}`,
        artistId: 'artist-1',
        albumId: 'album-1',
        mtime: Date.now(),
        checksum: `checksum-${i}`,
      });
    }

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
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes tags to every album song and queues resync jobs', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/albums/album-1/tags',
      cookies: { sessionId: cookieValue },
      payload: { title: 'Album Title', artist: 'Album Artist' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ updated: 2 });

    const jobs = db.prepare("SELECT * FROM scan_jobs WHERE type = 'resync'").all() as any[];
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => JSON.parse(j.stats).path).sort()).toEqual([
      join(config.LIBRARY_PATH, 'Album Artist', '(2024) Sample Album', '- Album Title (1).mp3'),
      join(config.LIBRARY_PATH, 'Album Artist', '(2024) Sample Album', '- Album Title.mp3'),
    ]);
  });

  it('returns 500 when resync queue fails during album tag write', async () => {
    const originalPrepare = db.prepare.bind(db);
    let callCount = 0;
    db.prepare = vi.fn((sql: string) => {
      if (sql.includes('scan_jobs') && sql.includes('resync')) {
        callCount++;
        if (callCount === 2) {
          throw new Error('DB is down');
        }
      }
      return originalPrepare(sql);
    }) as any;

    const res = await app.inject({
      method: 'PUT',
      url: '/api/albums/album-1/tags',
      cookies: { sessionId: cookieValue },
      payload: { title: 'Another Title' },
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('Tags saved and files reorganized, but resync queue failed');

    db.prepare = originalPrepare;
  });

  it('deletes an album and its songs recursively', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/albums/album-1',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const album = db.prepare('SELECT id FROM albums WHERE id = ?').get('album-1');
    expect(album).toBeUndefined();
    const songs = db.prepare('SELECT id FROM songs WHERE album_id = ?').all('album-1') as { id: string }[];
    expect(songs.length).toBe(0);
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/albums/album-1/tags',
      payload: { title: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
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
      method: 'PUT',
      url: '/api/albums/album-1/tags',
      cookies: { sessionId: regularCookie },
      payload: { title: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('uploads cover art for an album', async () => {
    const boundary = '----FormBoundary' + Date.now();
    const imageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/albums/album-1/cover-art',
      cookies: { sessionId: cookieValue },
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const { coverArt } = JSON.parse(res.body) as { coverArt: string };
    expect(coverArt).toBeTruthy();
    const row = db.prepare('SELECT cover_art_id FROM albums WHERE id = ?').get('album-1') as { cover_art_id: string };
    expect(row.cover_art_id).toBe(coverArt);
  });

  it('removes cover art for an album', async () => {
    db.prepare("INSERT INTO cover_arts (id, format, data, hash) VALUES ('cover-1', 'image/jpeg', X'', 'hash-1')").run();
    db.prepare("UPDATE albums SET cover_art_id = 'cover-1' WHERE id = ?").run('album-1');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/albums/album-1/cover-art',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const row = db.prepare('SELECT cover_art_id FROM albums WHERE id = ?').get('album-1') as { cover_art_id: string | null };
    expect(row.cover_art_id).toBeNull();
  });

  it('forbids album cover art upload for non-admins', async () => {
    createUser(db, {
      id: 'user-3',
      username: 'regular2',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'regular2', password: 'pass' },
    });
    const regularCookie = login.cookies.find((c) => c.name === 'sessionId')!.value;
    const boundary = '----FormBoundary' + Date.now();
    const imageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/albums/album-1/cover-art',
      cookies: { sessionId: regularCookie },
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });
});
