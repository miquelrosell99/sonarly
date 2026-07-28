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
import { createPlaylist } from '../../../src/features/playlists/repository.js';
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
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

async function seedDb(db: Database.Database) {
  createUser(db, {
    id: 'user-1',
    username: 'tester',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  upsertArtist(db, { id: 'artist-1', name: 'Test Artist' });
  upsertAlbum(db, { id: 'album-1', name: 'Test Album', artistId: 'artist-1', artistName: 'Test Artist' });
  upsertSong(db, {
    id: 'song-1',
    filePath: '/data/library/song1.mp3',
    title: 'Track One',
    artistId: 'artist-1',
    albumId: 'album-1',
    mtime: Date.now(),
    checksum: 'c1',
  });
  createPlaylist(db, {
    id: 'playlist-1',
    name: 'Test Playlist',
    ownerId: 'user-1',
    visibility: 'private',
    songIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

describe('favorites endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookieValue: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-favorites-${Date.now()}`);
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
      payload: { username: 'tester', password: 'pass' },
    });
    cookieValue = login.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      payload: { entityType: 'song', entityId: 'song-1', starred: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('stars and unstars a song', async () => {
    const star = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies: { sessionId: cookieValue },
      payload: { entityType: 'song', entityId: 'song-1', starred: true },
    });
    expect(star.statusCode).toBe(200);
    expect(JSON.parse(star.body)).toEqual({ ok: true });

    const row = db.prepare('SELECT starred FROM user_songs WHERE user_id = ? AND song_id = ?').get('user-1', 'song-1') as { starred: number };
    expect(row.starred).toBe(1);

    const unstar = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies: { sessionId: cookieValue },
      payload: { entityType: 'song', entityId: 'song-1', starred: false },
    });
    expect(unstar.statusCode).toBe(200);

    const rowAfter = db.prepare('SELECT starred FROM user_songs WHERE user_id = ? AND song_id = ?').get('user-1', 'song-1') as { starred: number };
    expect(rowAfter.starred).toBe(0);
  });

  it('stars albums, artists and playlists', async () => {
    for (const [entityType, entityId] of [['album', 'album-1'], ['artist', 'artist-1'], ['playlist', 'playlist-1']] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/favorites',
        cookies: { sessionId: cookieValue },
        payload: { entityType, entityId, starred: true },
      });
      expect(res.statusCode).toBe(200);
    }

    expect((db.prepare('SELECT starred FROM user_albums WHERE user_id = ? AND album_id = ?').get('user-1', 'album-1') as { starred: number }).starred).toBe(1);
    expect((db.prepare('SELECT starred FROM user_artists WHERE user_id = ? AND artist_id = ?').get('user-1', 'artist-1') as { starred: number }).starred).toBe(1);
    expect((db.prepare('SELECT starred FROM user_playlists WHERE user_id = ? AND playlist_id = ?').get('user-1', 'playlist-1') as { starred: number }).starred).toBe(1);
  });

  it('rejects invalid entity types', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies: { sessionId: cookieValue },
      payload: { entityType: 'invalid', entityId: 'song-1', starred: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rates and clears a rating', async () => {
    const rate = await app.inject({
      method: 'POST',
      url: '/api/ratings',
      cookies: { sessionId: cookieValue },
      payload: { entityType: 'song', entityId: 'song-1', rating: 5 },
    });
    expect(rate.statusCode).toBe(200);

    const row = db.prepare('SELECT rating FROM user_songs WHERE user_id = ? AND song_id = ?').get('user-1', 'song-1') as { rating: number };
    expect(row.rating).toBe(5);

    const clear = await app.inject({
      method: 'POST',
      url: '/api/ratings',
      cookies: { sessionId: cookieValue },
      payload: { entityType: 'song', entityId: 'song-1' },
    });
    expect(clear.statusCode).toBe(200);

    const rowAfter = db.prepare('SELECT rating FROM user_songs WHERE user_id = ? AND song_id = ?').get('user-1', 'song-1') as { rating: number | null };
    expect(rowAfter.rating).toBeNull();
  });

  it('accepts half-star ratings', async () => {
    const rate = await app.inject({
      method: 'POST',
      url: '/api/ratings',
      cookies: { sessionId: cookieValue },
      payload: { entityType: 'song', entityId: 'song-1', rating: 3.5 },
    });
    expect(rate.statusCode).toBe(200);

    const row = db.prepare('SELECT rating FROM user_songs WHERE user_id = ? AND song_id = ?').get('user-1', 'song-1') as { rating: number };
    expect(row.rating).toBe(3.5);
  });

  it('rejects out-of-range ratings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ratings',
      cookies: { sessionId: cookieValue },
      payload: { entityType: 'song', entityId: 'song-1', rating: 6 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects ratings that are not 0.5 increments', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ratings',
      cookies: { sessionId: cookieValue },
      payload: { entityType: 'song', entityId: 'song-1', rating: 3.7 },
    });
    expect(res.statusCode).toBe(400);
  });
});
