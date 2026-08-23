import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, copyFileSync, mkdtempSync, existsSync } from 'node:fs';
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
import { createPlaylist } from '../../../src/features/playlists/repository.js';
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

describe('management song endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookieValue: string;
  let tempDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-songs-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    tempDir = mkdtempSync(join(tmpdir(), 'sonarly-song-test-'));
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
    const filePath = join(config.LIBRARY_PATH, 'song1.mp3');
    copyFileSync(src, filePath);
    upsertSong(db, {
      id: 'song-1',
      filePath,
      title: 'Old Title',
      artistId: 'artist-1',
      albumId: 'album-1',
      mtime: Date.now(),
      checksum: 'checksum-1',
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

  it('rejects unknown tag fields', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/songs/song-1/tags',
      cookies: { sessionId: cookieValue },
      payload: { title: 'New', unknownField: 'bad' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('unknownField');
  });

  it('writes tags and queues a resync job', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/songs/song-1/tags',
      cookies: { sessionId: cookieValue },
      payload: { title: 'New Title', artist: 'New Artist', trackNumber: 2 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.orphanedEntities).toEqual([{ type: 'artist', id: 'artist-1', name: 'Test Artist' }]);

    const job = db.prepare("SELECT * FROM scan_jobs WHERE type = 'resync'").get() as any;
    expect(job).toBeDefined();
    expect(JSON.parse(job.stats).path).toBe(join(config.LIBRARY_PATH, 'New Artist', '(2024) Sample Album', '02 - New Title.mp3'));
  });

  it('returns 500 when resync queue fails after tag write', async () => {
    const originalPrepare = db.prepare.bind(db);
    db.prepare = vi.fn((sql: string) => {
      if (sql.includes('scan_jobs') && sql.includes('resync')) {
        throw new Error('DB is down');
      }
      return originalPrepare(sql);
    }) as any;

    const res = await app.inject({
      method: 'PUT',
      url: '/api/songs/song-1/tags',
      cookies: { sessionId: cookieValue },
      payload: { title: 'Another Title' },
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('Tags saved and file reorganized, but resync queue failed');

    db.prepare = originalPrepare;
  });

  it('returns a song with resolved artist and album names', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/songs/song-1',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.song.artistName).toBe('Test Artist');
    expect(body.song.albumName).toBe('Test Album');
  });

  it('writes multi-value artist and genre tags', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/songs/song-1/tags',
      cookies: { sessionId: cookieValue },
      payload: {
        title: 'New Title',
        artist: ['Artist A', 'Artist B'],
        genre: ['Rock', 'Pop'],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/songs/song-1',
      cookies: { sessionId: cookieValue },
    });
    expect(getRes.statusCode).toBe(200);
    const song = JSON.parse(getRes.body).song;
    expect(song.artistName).toBe('Artist A');
    expect(song.artists).toEqual(['Artist A', 'Artist B']);
    expect(song.genres).toEqual(['Rock', 'Pop']);

    const artistRows = db.prepare('SELECT artist_id FROM song_artists WHERE song_id = ? ORDER BY position').all('song-1') as { artist_id: string }[];
    const artistNames = artistRows.map((r) => db.prepare('SELECT name FROM artists WHERE id = ?').pluck().get(r.artist_id));
    expect(artistNames).toEqual(['Artist A', 'Artist B']);

    const genreRows = db.prepare('SELECT genre_id FROM song_genres WHERE song_id = ? ORDER BY position').all('song-1') as { genre_id: string }[];
    const genreNames = genreRows.map((r) => db.prepare('SELECT name FROM genres WHERE id = ?').pluck().get(r.genre_id));
    expect(genreNames).toEqual(['Rock', 'Pop']);
  });

  it('filters songs by genre', async () => {
    const src = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;
    const rockPath = join(config.LIBRARY_PATH, 'rock.mp3');
    const popPath = join(config.LIBRARY_PATH, 'pop.mp3');
    copyFileSync(src, rockPath);
    copyFileSync(src, popPath);
    db.prepare("INSERT INTO genres (id, name, active) VALUES ('genre-rock', 'Rock', 1), ('genre-pop', 'Pop', 1)").run();
    upsertSong(db, {
      id: 'song-rock',
      filePath: rockPath,
      title: 'Rock Song',
      artistId: 'artist-1',
      albumId: 'album-1',
      genre: 'Rock',
      genreId: 'genre-rock',
      mtime: Date.now(),
      checksum: 'checksum-rock',
    });
    upsertSong(db, {
      id: 'song-pop',
      filePath: popPath,
      title: 'Pop Song',
      artistId: 'artist-1',
      albumId: 'album-1',
      genre: 'Pop',
      genreId: 'genre-pop',
      mtime: Date.now(),
      checksum: 'checksum-pop',
    });
    db.prepare(`
      INSERT INTO song_genres (song_id, genre_id, position)
      VALUES ('song-rock', 'genre-rock', 0), ('song-pop', 'genre-pop', 0)
      ON CONFLICT(song_id, genre_id) DO NOTHING
    `).run();

    const res = await app.inject({
      method: 'GET',
      url: '/api/songs?genre=Rock',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { songs: { genre?: string }[] };
    expect(body.songs.length).toBeGreaterThan(0);
    expect(body.songs.every((s) => s.genre === 'Rock')).toBe(true);
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/songs/song-1/tags',
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
      url: '/api/songs/song-1/tags',
      cookies: { sessionId: regularCookie },
      payload: { title: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deletes a song file and database row for admins', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/songs/song-1',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const row = db.prepare('SELECT * FROM songs WHERE id = ?').get('song-1');
    expect(row).toBeUndefined();
    expect(existsSync(join(config.LIBRARY_PATH, 'song1.mp3'))).toBe(false);
  });

  it('returns 404 when deleting a missing song', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/songs/missing',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when a non-admin deletes a song', async () => {
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
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/songs/song-1',
      cookies: { sessionId: regularCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('uploads cover art for a song', async () => {
    const boundary = '----FormBoundary' + Date.now();
    const imageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/songs/song-1/cover-art',
      cookies: { sessionId: cookieValue },
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const { coverArt } = JSON.parse(res.body) as { coverArt: string };
    expect(coverArt).toBeTruthy();
    const row = db.prepare('SELECT cover_art_id FROM songs WHERE id = ?').get('song-1') as { cover_art_id: string };
    expect(row.cover_art_id).toBe(coverArt);
  });

  it('removes cover art for a song', async () => {
    db.prepare("INSERT INTO cover_arts (id, format, data, hash) VALUES ('cover-1', 'image/jpeg', X'', 'hash-1')").run();
    db.prepare("UPDATE songs SET cover_art_id = 'cover-1' WHERE id = ?").run('song-1');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/songs/song-1/cover-art',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const row = db.prepare('SELECT cover_art_id FROM songs WHERE id = ?').get('song-1') as { cover_art_id: string | null };
    expect(row.cover_art_id).toBeNull();
  });

  it('rejects invalid cover art formats', async () => {
    const boundary = '----FormBoundary' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.gif"\r\nContent-Type: image/gif\r\n\r\nGIF89a\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/songs/song-1/cover-art',
      cookies: { sessionId: cookieValue },
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Invalid image format');
  });

  it('forbids cover art upload for non-admins', async () => {
    createUser(db, {
      id: 'user-4',
      username: 'regular3',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'regular3', password: 'pass' },
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
      url: '/api/songs/song-1/cover-art',
      cookies: { sessionId: regularCookie },
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  describe('GET /api/stream/:id share-token access', () => {
    const SHARE_TOKEN = 'share-token-123';

    function seedSharedPlaylist() {
      upsertSong(db, {
        id: 'song-2',
        filePath: join(config.LIBRARY_PATH, 'song2.mp3'),
        title: 'Other Track',
        artistId: 'artist-1',
        mtime: Date.now(),
        checksum: 'checksum-2',
      });
      createPlaylist(db, {
        id: 'playlist-1',
        name: 'Link',
        ownerId: 'user-1',
        visibility: 'link',
        shareToken: SHARE_TOKEN,
        songIds: ['song-1'],
        isSmart: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    it('streams a song in the linked playlist to anonymous token holders', async () => {
      seedSharedPlaylist();
      const res = await app.inject({
        method: 'GET',
        url: `/api/stream/song-1?shareToken=${SHARE_TOKEN}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.rawPayload.length).toBeGreaterThan(0);
    });

    it('supports range requests with a share token', async () => {
      seedSharedPlaylist();
      const res = await app.inject({
        method: 'GET',
        url: `/api/stream/song-1?shareToken=${SHARE_TOKEN}`,
        headers: { range: 'bytes=0-99' },
      });
      expect(res.statusCode).toBe(206);
      expect(res.rawPayload.length).toBe(100);
    });

    it('rejects a song outside the linked playlist', async () => {
      seedSharedPlaylist();
      const res = await app.inject({
        method: 'GET',
        url: `/api/stream/song-2?shareToken=${SHARE_TOKEN}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects an unknown share token', async () => {
      seedSharedPlaylist();
      const res = await app.inject({
        method: 'GET',
        url: '/api/stream/song-1?shareToken=wrong-token',
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects anonymous requests without a share token', async () => {
      seedSharedPlaylist();
      const res = await app.inject({ method: 'GET', url: '/api/stream/song-1' });
      expect(res.statusCode).toBe(401);
    });

    it('still streams for signed-in users', async () => {
      seedSharedPlaylist();
      const res = await app.inject({
        method: 'GET',
        url: '/api/stream/song-2',
        cookies: { sessionId: cookieValue },
      });
      // song-2 has no file on disk, but auth must pass before the 404.
      expect(res.statusCode).toBe(404);
    });

    describe('smart playlist grants', () => {
      const SMART_SHARE_TOKEN = 'smart-share-token-123';

      function seedSmartSharedPlaylist() {
        // song-1 ('Old Title') matches the rule; song-2 does not.
        upsertSong(db, {
          id: 'song-2',
          filePath: join(config.LIBRARY_PATH, 'song2.mp3'),
          title: 'Other Track',
          artistId: 'artist-1',
          mtime: Date.now(),
          checksum: 'checksum-2',
        });
        createPlaylist(db, {
          id: 'smart-playlist-1',
          name: 'Smart Link',
          ownerId: 'user-1',
          visibility: 'link',
          shareToken: SMART_SHARE_TOKEN,
          songIds: [],
          isSmart: true,
          rules: { rules: { all: [{ field: 'title', operator: 'contains', value: 'Old' }] } },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      it('streams a rule-matching song to anonymous token holders', async () => {
        seedSmartSharedPlaylist();
        const res = await app.inject({
          method: 'GET',
          url: `/api/stream/song-1?shareToken=${SMART_SHARE_TOKEN}`,
        });
        expect(res.statusCode).toBe(200);
        expect(res.rawPayload.length).toBeGreaterThan(0);
      });

      it('rejects a song outside the smart playlist rules', async () => {
        seedSmartSharedPlaylist();
        const res = await app.inject({
          method: 'GET',
          url: `/api/stream/song-2?shareToken=${SMART_SHARE_TOKEN}`,
        });
        expect(res.statusCode).toBe(403);
      });

      it('rejects an unknown share token for a smart playlist', async () => {
        seedSmartSharedPlaylist();
        const res = await app.inject({
          method: 'GET',
          url: '/api/stream/song-1?shareToken=wrong-token',
        });
        expect(res.statusCode).toBe(403);
      });
    });
  });
});
