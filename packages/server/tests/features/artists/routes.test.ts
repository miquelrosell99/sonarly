import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';
import { upsertAlbum } from '../../../src/features/albums/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
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
  REVIEW_RETENTION_DAYS: 30,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

describe('management artist endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookieValue: string;
  let tempDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-artists-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    tempDir = mkdtempSync(join(tmpdir(), 'sonarly-artist-test-'));
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
    upsertAlbum(db, { id: 'album-1', name: 'Test Album', artistId: 'artist-1', artistName: 'Test Artist', year: 2024 });
    upsertSong(db, {
      id: 'song-1',
      filePath: '/data/library/song1.mp3',
      title: 'Test Song',
      artistId: 'artist-1',
      albumId: 'album-1',
      year: 2024,
      mtime: Date.now(),
      checksum: 'c1',
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
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists all artists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/artists',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      artists: [{ id: 'artist-1', name: 'Test Artist', active: true, starred: false }],
    });
  });

  it('returns a single artist with albums', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/artists/artist-1',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      artist: {
        id: 'artist-1',
        name: 'Test Artist',
        active: true,
        starred: false,
        albums: [{ id: 'album-1', name: 'Test Album', year: 2024, shownSongCount: 1, totalSongCount: 1, starred: false }],
      },
    });
  });

  it('returns 404 for an unknown artist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/artists/unknown',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Artist not found' });
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/artists',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns songs for an artist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/artists/artist-1/songs',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { songs: { id: string }[] };
    expect(body.songs.length).toBeGreaterThanOrEqual(1);
  });

  it('serves a local artist image', async () => {
    const imagesDir = join(root, 'artist-images');
    mkdirSync(imagesDir, { recursive: true });
    const imagePath = join(imagesDir, 'artist-1.jpg');
    await writeFile(imagePath, Buffer.from('fake-image'));
    db.prepare('UPDATE artists SET artist_image_local_path = ? WHERE id = ?').run(imagePath, 'artist-1');

    const res = await app.inject({
      method: 'GET',
      url: '/api/artist-images/artist-1',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.body).toBe('fake-image');
  });

  it('returns 404 when artist has no local image', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/artist-images/artist-1',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Artist image not found' });
  });

  it('deletes an empty artist and their empty albums', async () => {
    db.prepare("UPDATE songs SET artist_id = NULL, album_id = NULL WHERE id = 'song-1'").run();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/artists/artist-1',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.deletedAlbums).toBe(1);

    const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get('artist-1');
    expect(artist).toBeUndefined();
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get('album-1');
    expect(album).toBeUndefined();
  });

  it('refuses to delete an artist with active songs', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/artists/artist-1',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('Cannot delete artist with active songs');
  });

  it('returns 403 when a non-admin deletes an artist', async () => {
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
      method: 'DELETE',
      url: '/api/artists/artist-1',
      cookies: { sessionId: regularCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
