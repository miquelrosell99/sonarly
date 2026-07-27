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
import { updateUserContentFilters } from '../../../src/features/users/repository.js';
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

async function seedDb(db: Database.Database) {
  createUser(db, {
    id: 'user-1',
    username: 'user',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  upsertArtist(db, {
    id: 'artist-1',
    name: 'Artist',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  upsertAlbum(db, {
    id: 'album-1',
    name: 'Album',
    artistId: 'artist-1',
    artistName: 'Artist',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  upsertSong(db, {
    id: 'song-1',
    filePath: '/data/library/clean.mp3',
    title: 'Clean Song',
    artistId: 'artist-1',
    albumId: 'album-1',
    duration: 180,
    mtime: Date.now(),
    checksum: 'c1',
  });
  upsertSong(db, {
    id: 'song-2',
    filePath: '/data/library/explicit.mp3',
    title: 'Explicit Song',
    artistId: 'artist-1',
    albumId: 'album-1',
    explicit: true,
    duration: 180,
    mtime: Date.now(),
    checksum: 'c2',
  });
}

describe('explicit content filtering endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database.Database;
  let cookie: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-explicit-${Date.now()}`);
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
    await seedDb(db);

    app = await buildApp(config, db);

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'user', password: 'pass' },
    });
    cookie = login.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('hides explicit songs when user preference is enabled', async () => {
    updateUserContentFilters(db, 'user-1', { hideExplicit: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/songs',
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(200);
    const songs = JSON.parse(res.body).songs;
    expect(songs).toHaveLength(1);
    expect(songs[0].title).toBe('Clean Song');
  });

  it('returns explicit songs when preference is disabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/songs',
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(200);
    const songs = JSON.parse(res.body).songs;
    expect(songs).toHaveLength(2);
    expect(songs.map((s: { title: string }) => s.title)).toContain('Explicit Song');
  });

  it('hides albums with only explicit songs', async () => {
    upsertSong(db, {
      id: 'song-3',
      filePath: '/data/library/only-explicit.mp3',
      title: 'Only Explicit',
      artistId: 'artist-1',
      albumId: 'album-1',
      explicit: true,
      duration: 180,
      mtime: Date.now(),
      checksum: 'c3',
    });
    updateUserContentFilters(db, 'user-1', { hideExplicit: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/albums',
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(200);
    const albums = JSON.parse(res.body).albums;
    expect(albums).toHaveLength(1);
    expect(albums[0].shownSongCount).toBe(1);
    expect(albums[0].totalSongCount).toBe(3);
  });

  it('returns 404 for explicit song detail when hidden', async () => {
    updateUserContentFilters(db, 'user-1', { hideExplicit: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/songs/song-2',
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
