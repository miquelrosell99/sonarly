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

async function seedDb(db: Database.Database) {
  createUser(db, {
    id: 'owner-1',
    username: 'owner',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  upsertArtist(db, {
    id: 'artist-1',
    name: 'Radiohead',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  upsertAlbum(db, {
    id: 'album-1',
    name: 'OK Computer',
    artistId: 'artist-1',
    artistName: 'Radiohead',
    year: 1997,
    genre: 'Alternative Rock',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  upsertSong(db, {
    id: 'song-1',
    filePath: '/data/library/song1.mp3',
    title: 'Airbag',
    artistId: 'artist-1',
    albumId: 'album-1',
    genre: 'Alternative Rock',
    year: 1997,
    duration: 180,
    mtime: Date.now(),
    checksum: 'c1',
  });
  upsertSong(db, {
    id: 'song-2',
    filePath: '/data/library/song2.mp3',
    title: 'Paranoid Android',
    artistId: 'artist-1',
    albumId: 'album-1',
    genre: 'Alternative Rock',
    year: 1997,
    duration: 240,
    mtime: Date.now(),
    checksum: 'c2',
  });
}

describe('smart playlist management endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ownerCookie: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-smart-playlists-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    config = {
      ...baseConfig,
      DATA_DIR: root,
      LIBRARY_PATH: join(root, 'library'),
      INGEST_PATH: join(root, 'ingest'),
    };
    mkdirSync(config.LIBRARY_PATH, { recursive: true });
    mkdirSync(config.INGEST_PATH, { recursive: true });

    const db = new Database(join(root, 'sonarly.db'));
    migrate(db);
    await seedDb(db);

    app = await buildApp(config, db);

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'owner', password: 'pass' },
    });
    ownerCookie = login.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('creates a smart playlist with rules', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: {
        name: 'Smart 90s',
        isSmart: true,
        rules: {
          rules: {
            all: [{ field: 'year', operator: 'inTheRange', value: [1990, 1999] }],
          },
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const body = JSON.parse(create.body);
    expect(body.playlist.isSmart).toBe(true);
    expect(body.playlist.songIds).toEqual([]);
  });

  it('resolves smart playlist entries dynamically', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: {
        name: 'Smart Radiohead',
        isSmart: true,
        rules: {
          rules: {
            all: [{ field: 'artist', operator: 'is', value: 'Radiohead' }],
          },
        },
      },
    });
    const id = JSON.parse(create.body).playlist.id;

    const get = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
    });
    expect(get.statusCode).toBe(200);
    const playlist = JSON.parse(get.body).playlist;
    expect(playlist.songCount).toBe(2);
    expect(playlist.entries).toHaveLength(2);
  });

  it('rejects manual song edits on smart playlists', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: {
        name: 'Smart Radiohead',
        isSmart: true,
        rules: {
          rules: {
            all: [{ field: 'artist', operator: 'is', value: 'Radiohead' }],
          },
        },
      },
    });
    const id = JSON.parse(create.body).playlist.id;

    const update = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
      payload: { songIds: ['song-1'] },
    });
    expect(update.statusCode).toBe(400);
  });

  it('updates smart playlist rules', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: {
        name: 'Smart Radiohead',
        isSmart: true,
        rules: {
          rules: {
            all: [{ field: 'artist', operator: 'is', value: 'Radiohead' }],
          },
        },
      },
    });
    const id = JSON.parse(create.body).playlist.id;

    const update = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
      payload: {
        rules: {
          rules: {
            all: [{ field: 'title', operator: 'is', value: 'Airbag' }],
          },
        },
      },
    });
    expect(update.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
    });
    const playlist = JSON.parse(get.body).playlist;
    expect(playlist.songCount).toBe(1);
    expect(playlist.entries[0].id).toBe('song-1');
  });
});
