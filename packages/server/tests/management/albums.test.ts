import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrate.js';
import { hashPassword } from '../../src/auth/password.js';
import { createUser } from '../../src/db/repositories/user-repository.js';
import { upsertSong } from '../../src/db/repositories/song-repository.js';
import { upsertArtist } from '../../src/db/repositories/artist-repository.js';
import { upsertAlbum } from '../../src/db/repositories/album-repository.js';
import { registerDefaultWriters } from '../../src/tags/index.js';
import type { Config } from '../../src/config.js';

registerDefaultWriters();

vi.mock('node:worker_threads', () => {
  class MockWorker {
    postMessage = vi.fn();
    on = vi.fn();
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
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    upsertArtist(db, { id: 'artist-1', name: 'Test Artist' });
    upsertAlbum(db, { id: 'album-1', name: 'Test Album', artistName: 'Test Artist' });

    const src = new URL('../fixtures/sample.mp3', import.meta.url).pathname;
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
      join(config.LIBRARY_PATH, 'song1.mp3'),
      join(config.LIBRARY_PATH, 'song2.mp3'),
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
    expect(JSON.parse(res.body).error).toBe('Tag update succeeded but resync queue failed');

    db.prepare = originalPrepare;
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/albums/album-1/tags',
      payload: { title: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});
