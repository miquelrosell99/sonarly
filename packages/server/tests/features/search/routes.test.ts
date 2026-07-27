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
  createUser(db, {
    id: 'owner-1',
    username: 'owner',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  upsertArtist(db, { id: 'artist-1', name: 'Alpha Artist' });
  upsertAlbum(db, { id: 'album-1', name: 'Alpha Album', artistId: 'artist-1', artistName: 'Alpha Artist' });
  upsertSong(db, {
    id: 'song-1',
    filePath: '/data/library/song1.mp3',
    title: 'Alpha Song',
    artistId: 'artist-1',
    albumId: 'album-1',
    mtime: Date.now(),
    checksum: 'c1',
  });
  for (let i = 2; i <= 7; i++) {
    upsertSong(db, {
      id: `song-${i}`,
      filePath: `/data/library/song${i}.mp3`,
      title: `Alpha Song ${i}`,
      artistId: 'artist-1',
      albumId: 'album-1',
      mtime: Date.now(),
      checksum: `c${i}`,
    });
  }
  createPlaylist(db, {
    id: 'playlist-1',
    name: 'Alpha Playlist',
    ownerId: 'owner-1',
    visibility: 'public',
    songIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  createPlaylist(db, {
    id: 'playlist-2',
    name: 'Private Playlist',
    ownerId: 'owner-1',
    visibility: 'private',
    songIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

describe('search endpoint', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookieValue: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-search-${Date.now()}`);
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

  it('returns empty results for an empty query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ songs: [], albums: [], artists: [], playlists: [] });
  });

  it('returns matching entities', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.songs).toHaveLength(6);
    expect(body.songs[0].id).toBe('song-1');
    expect(body.songs[0].artistName).toBe('Alpha Artist');
    expect(body.songs[0].albumName).toBe('Alpha Album');
    expect(body.albums).toHaveLength(1);
    expect(body.albums[0].id).toBe('album-1');
    expect(body.artists).toHaveLength(1);
    expect(body.artists[0].id).toBe('artist-1');
    expect(body.playlists).toHaveLength(1);
    expect(body.playlists[0].id).toBe('playlist-1');
  });

  it('respects playlist visibility', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=private',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.playlists).toHaveLength(0);
  });

  it('includes starred and rating when set', async () => {
    db.prepare('INSERT INTO user_songs (user_id, song_id, starred, rating) VALUES (?, ?, ?, ?)').run('user-1', 'song-1', 1, 4);

    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha',
      cookies: { sessionId: cookieValue },
    });
    const body = JSON.parse(res.body);
    expect(body.songs[0].starred).toBe(true);
    expect(body.songs[0].rating).toBe(4);
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha',
    });
    expect(res.statusCode).toBe(401);
  });

  it('limits each category to 5 results by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha',
      cookies: { sessionId: cookieValue },
    });
    const body = JSON.parse(res.body);
    expect(body.songs.length).toBeLessThanOrEqual(6);
    expect(body.albums.length).toBeLessThanOrEqual(6);
    expect(body.artists.length).toBeLessThanOrEqual(6);
    expect(body.playlists.length).toBeLessThanOrEqual(6);
  });

  it('returns up to limit + 1 results when limit is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha&limit=2',
      cookies: { sessionId: cookieValue },
    });
    const body = JSON.parse(res.body);
    expect(body.songs.length).toBeLessThanOrEqual(3);
  });

  it('filters to a single category when type is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha&type=songs',
      cookies: { sessionId: cookieValue },
    });
    const body = JSON.parse(res.body);
    expect(body.songs.length).toBeGreaterThan(0);
    expect(body.albums).toEqual([]);
    expect(body.artists).toEqual([]);
    expect(body.playlists).toEqual([]);
  });

  it('returns 400 for invalid type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha&type=invalid',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(400);
  });

  it('caps full-category search results at 250 by default', async () => {
    for (let i = 8; i <= 260; i++) {
      upsertSong(db, {
        id: `song-${i}`,
        filePath: `/data/library/song${i}.mp3`,
        title: `Alpha Song ${i}`,
        artistId: 'artist-1',
        albumId: 'album-1',
        mtime: Date.now(),
        checksum: `c${i}`,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha&type=songs',
      cookies: { sessionId: cookieValue },
    });
    const body = JSON.parse(res.body);
    expect(body.songs.length).toBe(250);
  });

  it('caps an explicit limit above 250 for full-category search', async () => {
    for (let i = 8; i <= 260; i++) {
      upsertSong(db, {
        id: `song-${i}`,
        filePath: `/data/library/song${i}.mp3`,
        title: `Alpha Song ${i}`,
        artistId: 'artist-1',
        albumId: 'album-1',
        mtime: Date.now(),
        checksum: `c${i}`,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=alpha&type=songs&limit=300',
      cookies: { sessionId: cookieValue },
    });
    const body = JSON.parse(res.body);
    expect(body.songs.length).toBe(250);
  });
});
