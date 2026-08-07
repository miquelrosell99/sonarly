import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { registerOpenSubsonicRoutes } from '../../../src/features/opensubsonic/routes/system.js';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { buildSubsonicToken } from '../../../src/features/auth/token.js';
import { encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import type { Config } from '../../../src/config.js';

const config: Config = {
  PORT: 3000,
  NODE_ENV: 'test',
  SESSION_SECRET: 'a-secret-key-that-is-long-enough-for-the-session-secret-32',
  SESSION_COOKIE_SECURE: false,
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

function seedUser(db: Database.Database) {
  const username = 'tester';
  const password = 'supersecret';
  const subsonicPasswordEncrypted = encryptSubsonicPassword(password, config.SESSION_SECRET);
  const salt = 'salty';
  const token = buildSubsonicToken(password, salt);
  createUser(db, { id: 'user-1', username, passwordHash: 'ignored', subsonicPasswordEncrypted, isAdmin: false, createdAt: new Date().toISOString() });
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

describe('OpenSubsonic bookmark endpoints', () => {
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

  function getBookmark(songId: string) {
    return db.prepare('SELECT position, comment FROM bookmarks WHERE user_id = ? AND song_id = ?')
      .get('user-1', songId) as { position: number; comment: string | null } | undefined;
  }

  it('returns empty bookmarks when none exist', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getBookmarks.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
    expect(body['subsonic-response'].bookmarks.bookmark).toHaveLength(0);
  });

  it('creates a bookmark for a song', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createBookmark.view?id=song-1&position=12345', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');

    const bookmark = getBookmark('song-1');
    expect(bookmark?.position).toBe(12345);
    expect(bookmark?.comment).toBeNull();
  });

  it('creates a bookmark with a comment', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createBookmark.view?id=song-1&position=12345&comment=resume%20here', 'json'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)['subsonic-response'].status).toBe('ok');
    expect(getBookmark('song-1')?.comment).toBe('resume here');
  });

  it('updates an existing bookmark position', async () => {
    await app.inject({ method: 'GET', url: query('/rest/createBookmark.view?id=song-1&position=10000', 'json') });

    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createBookmark.view?id=song-1&position=25000', 'json'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)['subsonic-response'].status).toBe('ok');

    const bookmark = getBookmark('song-1');
    expect(bookmark?.position).toBe(25000);
  });

  it('rejects a missing id parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createBookmark.view?position=12345', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects a missing position parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createBookmark.view?id=song-1', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects a negative position', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createBookmark.view?id=song-1&position=-1', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects a non-integer position', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createBookmark.view?id=song-1&position=12.5', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects a bookmark for a missing song', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createBookmark.view?id=missing&position=12345', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });

  it('returns bookmarks from getBookmarks', async () => {
    await app.inject({ method: 'GET', url: query('/rest/createBookmark.view?id=song-1&position=12345&comment=resume', 'json') });

    const res = await app.inject({ method: 'GET', url: query('/rest/getBookmarks.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');

    const bookmarks = body['subsonic-response'].bookmarks.bookmark;
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].position).toBe(12345);
    expect(bookmarks[0].username).toBe('tester');
    expect(bookmarks[0].comment).toBe('resume');
    expect(bookmarks[0].entry.id).toBe('song-1');
  });

  it('deletes a bookmark', async () => {
    await app.inject({ method: 'GET', url: query('/rest/createBookmark.view?id=song-1&position=12345', 'json') });
    expect(getBookmark('song-1')).toBeDefined();

    const res = await app.inject({
      method: 'GET',
      url: query('/rest/deleteBookmark.view?id=song-1', 'json'),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)['subsonic-response'].status).toBe('ok');
    expect(getBookmark('song-1')).toBeUndefined();
  });

  it('rejects a missing id on delete', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/deleteBookmark.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('isolates bookmarks between users', async () => {
    createUser(db, {
      id: 'user-2',
      username: 'other',
      passwordHash: 'ignored',
      subsonicPasswordEncrypted: encryptSubsonicPassword('otherpass', config.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });

    const otherToken = buildSubsonicToken('otherpass', 'other-salt');
    await app.inject({
      method: 'GET',
      url: `/rest/createBookmark.view?id=song-1&position=999&u=other&t=${otherToken}&s=other-salt&f=json`,
    });

    const res = await app.inject({ method: 'GET', url: query('/rest/getBookmarks.view?', 'json') });
    expect(JSON.parse(res.body)['subsonic-response'].bookmarks.bookmark).toHaveLength(0);
  });
});
