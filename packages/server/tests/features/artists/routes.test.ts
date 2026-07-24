import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
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
});
