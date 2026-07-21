import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { registerOpenSubsonicRoutes } from '../../src/opensubsonic/routes/system.js';
import { migrate } from '../../src/db/migrate.js';
import { createUser } from '../../src/db/repositories/user-repository.js';
import { upsertSong } from '../../src/db/repositories/song-repository.js';
import { buildSubsonicToken } from '../../src/auth/token.js';
import type { Config } from '../../src/config.js';

const config: Config = {
  PORT: 3000,
  NODE_ENV: 'test',
  SESSION_SECRET: 'a-secret-key-that-is-long-enough-for-the-session-secret-32',
  SESSION_COOKIE_SECURE: false,
  USE_CRYPTO: false,
  DATA_DIR: '/data',
  LIBRARY_PATH: '/data/library',
  INGEST_PATH: '/data/ingest',
  ORGANIZE_PATTERN: '{artist}/{album}/{track:00} - {title}{ext}',
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

function seedUser(db: Database.Database) {
  const username = 'tester';
  const passwordHash = 'supersecret';
  const salt = 'salty';
  const token = buildSubsonicToken(passwordHash, salt);
  createUser(db, { id: 'user-1', username, passwordHash, isAdmin: false, createdAt: new Date().toISOString() });
  return { username, token, salt };
}

function seedSongs(db: Database.Database) {
  upsertSong(db, {
    id: 'song-1',
    filePath: '/data/library/song1.mp3',
    title: 'Track One',
    duration: 180,
    mtime: Date.now(),
    checksum: 'checksum-1',
  });
  upsertSong(db, {
    id: 'song-2',
    filePath: '/data/library/song2.mp3',
    title: 'Track Two',
    duration: 200,
    mtime: Date.now(),
    checksum: 'checksum-2',
  });
}

describe('OpenSubsonic starring and interaction endpoints', () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;
  let auth: ReturnType<typeof seedUser>;

  beforeEach(async () => {
    db = new Database(':memory:');
    migrate(db);
    auth = seedUser(db);
    seedSongs(db);
    app = Fastify();
    await registerOpenSubsonicRoutes(app, config, db);
  });

  afterEach(() => {
    db.close();
  });

  function query(url: string, format: 'json' | 'xml' = 'json') {
    return `${url}&u=${auth.username}&t=${auth.token}&s=${auth.salt}&f=${format}`;
  }

  function getUserSong(songId: string) {
    return db.prepare('SELECT starred, rating, play_count, last_played FROM user_songs WHERE user_id = ? AND song_id = ?')
      .get('user-1', songId) as { starred: number; rating: number | null; play_count: number; last_played: string | null } | undefined;
  }

  it('stars a single song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/star.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
    expect(getUserSong('song-1')?.starred).toBe(1);
  });

  it('stars multiple songs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/star.view?id=song-1&id=song-2', 'json'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)['subsonic-response'].status).toBe('ok');
    expect(getUserSong('song-1')?.starred).toBe(1);
    expect(getUserSong('song-2')?.starred).toBe(1);
  });

  it('unstars a song', async () => {
    await app.inject({ method: 'GET', url: query('/rest/star.view?id=song-1', 'json') });
    const res = await app.inject({ method: 'GET', url: query('/rest/unstar.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)['subsonic-response'].status).toBe('ok');
    expect(getUserSong('song-1')?.starred).toBe(0);
  });

  it('sets a rating for a song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/setRating.view?id=song-1&rating=4', 'json') });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)['subsonic-response'].status).toBe('ok');
    expect(getUserSong('song-1')?.rating).toBe(4);
  });

  it('rejects a missing rating parameter', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/setRating.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
    expect(getUserSong('song-1')).toBeUndefined();
  });

  it('rejects a non-numeric rating', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/setRating.view?id=song-1&rating=abc', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects a rating outside the 0-5 range', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/setRating.view?id=song-1&rating=6', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects a negative rating', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/setRating.view?id=song-1&rating=-1', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('scrobbles a single song and increments play count', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/scrobble.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)['subsonic-response'].status).toBe('ok');
    const row = getUserSong('song-1');
    expect(row?.play_count).toBe(1);
    expect(row?.last_played).toBeTruthy();
  });

  it('scrobbles multiple songs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/scrobble.view?id=song-1&id=song-2', 'json'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)['subsonic-response'].status).toBe('ok');
    expect(getUserSong('song-1')?.play_count).toBe(1);
    expect(getUserSong('song-2')?.play_count).toBe(1);
  });

  it('increments play count on repeated scrobbles', async () => {
    await app.inject({ method: 'GET', url: query('/rest/scrobble.view?id=song-1', 'json') });
    await app.inject({ method: 'GET', url: query('/rest/scrobble.view?id=song-1', 'json') });
    expect(getUserSong('song-1')?.play_count).toBe(2);
  });
});
