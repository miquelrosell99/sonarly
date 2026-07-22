import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';
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
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

describe('management conflict endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-conflicts-${Date.now()}`);
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
      subsonicPasswordEncrypted: encryptSubsonicPassword('adminpass', baseConfig.SESSION_SECRET),
      isAdmin: true,
      createdAt: new Date().toISOString(),
    });
    createUser(db, {
      id: 'user-1',
      username: 'regular',
      passwordHash: await hashPassword('regularpass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('regularpass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });

    upsertArtist(db, { id: 'artist-1', name: 'Artist' });
    upsertAlbum(db, { id: 'album-1', name: 'Album', artistName: 'Artist' });
    const src = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;

    const files = [
      { id: 'song-1', path: join(config.LIBRARY_PATH, 'track.mp3'), title: 'Track' },
      { id: 'song-2', path: join(config.LIBRARY_PATH, 'track (1).mp3'), title: 'Track Duplicate' },
      { id: 'song-3', path: join(config.LIBRARY_PATH, 'track (live).mp3'), title: 'Track Live' },
    ];
    for (const file of files) {
      copyFileSync(src, file.path);
      upsertSong(db, {
        id: file.id,
        filePath: file.path,
        title: file.title,
        artistId: 'artist-1',
        albumId: 'album-1',
        mtime: Date.now(),
        checksum: `checksum-${file.id}`,
      });
    }

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

  it('returns collision files for admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conflicts',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].id).toBe('song-2');
    expect(body.conflicts[0].artistName).toBe('Artist');
    expect(body.conflicts[0].albumName).toBe('Album');
  });

  it('forbids non-admins', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'regular', password: 'regularpass' },
    });
    const regularCookie = login.cookies.find((c) => c.name === 'sessionId')!.value;
    const res = await app.inject({
      method: 'GET',
      url: '/api/conflicts',
      cookies: { sessionId: regularCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conflicts' });
    expect(res.statusCode).toBe(401);
  });
});
