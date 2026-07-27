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
  ORGANIZE_PATTERN: '{artist}/{album}/{track:00} - {title}',
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

describe('home endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookieValue: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-home-${Date.now()}`);
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
      username: 'tester',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
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
  });

  it('excludes empty genres from the genre list', async () => {
    upsertArtist(db, { id: 'artist-1', name: 'Artist' });
    upsertAlbum(db, {
      id: 'album-1',
      name: 'Album',
      artistId: 'artist-1',
      artistName: 'Artist',
      genre: 'Rock',
    });
    upsertAlbum(db, {
      id: 'album-2',
      name: 'Album Two',
      artistId: 'artist-1',
      artistName: 'Artist',
      genre: '',
    });
    upsertSong(db, {
      id: 'song-1',
      filePath: '/data/library/song1.mp3',
      title: 'Track One',
      duration: 180,
      artistId: 'artist-1',
      albumId: 'album-1',
      genre: 'Pop',
      mtime: Date.now(),
      checksum: 'c1',
    });
    upsertSong(db, {
      id: 'song-2',
      filePath: '/data/library/song2.mp3',
      title: 'Track Two',
      duration: 180,
      artistId: 'artist-1',
      albumId: 'album-2',
      genre: '',
      mtime: Date.now(),
      checksum: 'c2',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/home',
      cookies: { sessionId: cookieValue },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { genres: string[] };
    expect(body.genres).toContain('Rock');
    expect(body.genres).toContain('Pop');
    expect(body.genres).not.toContain('');
  });
});
