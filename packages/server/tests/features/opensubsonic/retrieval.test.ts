import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { registerOpenSubsonicRoutes } from '../../../src/features/opensubsonic/routes/system.js';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { buildSubsonicToken } from '../../../src/features/auth/token.js';
import { encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { clearActivePlayers, getActivePlayers } from '../../../src/features/players/tracker.js';
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

const fixturePath = fileURLToPath(new URL('../../fixtures/sample.mp3', import.meta.url));
const fixtureBytes = readFileSync(fixturePath);

function seedUser(db: Database.Database) {
  const username = 'tester';
  const password = 'supersecret';
  const subsonicPasswordEncrypted = encryptSubsonicPassword(password, config.SESSION_SECRET);
  const salt = 'salty';
  const token = buildSubsonicToken(password, salt);
  createUser(db, { id: 'user-1', username, passwordHash: 'ignored', subsonicPasswordEncrypted, isAdmin: false, createdAt: new Date().toISOString() });
  return { username, token, salt };
}

function seedSong(db: Database.Database) {
  upsertSong(db, {
    id: 'song-1',
    filePath: fixturePath,
    title: 'Sample Song',
    duration: 1,
    mtime: Date.now(),
    checksum: 'checksum-1',
  });
}

describe('OpenSubsonic retrieval endpoints', () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;
  let auth: ReturnType<typeof seedUser>;

  beforeEach(async () => {
    clearActivePlayers();
    db = new Database(':memory:');
    migrate(db);
    auth = seedUser(db);
    seedSong(db);
    app = Fastify();
    app.addHook('preHandler', async (request) => {
      (request as any).session = { userId: 'user-1' };
    });
    await registerOpenSubsonicRoutes(app, config, db);
  });

  afterEach(() => {
    db.close();
  });

  function query(url: string, format: 'json' | 'xml' = 'json') {
    return `${url}&u=${auth.username}&t=${auth.token}&s=${auth.salt}&f=${format}`;
  }

  it('streams an existing song with correct mime type and accepts ranges', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/stream.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.rawPayload.length).toBe(fixtureBytes.length);
  });

  it('streams with a valid session cookie when subsonic credentials are omitted', async () => {
    const res = await app.inject({ method: 'GET', url: '/rest/stream.view?id=song-1&f=json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.rawPayload.length).toBe(fixtureBytes.length);
  });

  it('returns 206 for a single byte range request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/stream.view?id=song-1', 'json'),
      headers: { range: 'bytes=0-9' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['content-range']).toBe(`bytes 0-9/${fixtureBytes.length}`);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.rawPayload.length).toBe(10);
  });

  it('returns 206 for an open-ended byte range request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/stream.view?id=song-1', 'json'),
      headers: { range: 'bytes=10-' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 10-${fixtureBytes.length - 1}/${fixtureBytes.length}`);
    expect(res.rawPayload.length).toBe(fixtureBytes.length - 10);
  });

  it('returns 206 for a suffix byte range request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/stream.view?id=song-1', 'json'),
      headers: { range: 'bytes=-10' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes ${fixtureBytes.length - 10}-${fixtureBytes.length - 1}/${fixtureBytes.length}`);
    expect(res.rawPayload.length).toBe(10);
    expect(Buffer.compare(res.rawPayload, fixtureBytes.subarray(-10))).toBe(0);
  });

  it('returns 416 for an out-of-range byte range request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/stream.view?id=song-1', 'json'),
      headers: { range: `bytes=${fixtureBytes.length}-` },
    });
    expect(res.statusCode).toBe(416);
  });

  it('records a player for a byte-range request', async () => {
    clearActivePlayers();
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/stream.view?id=song-1', 'json'),
      headers: { range: 'bytes=0-9' },
    });
    expect(res.statusCode).toBe(206);
    expect(getActivePlayers()).toHaveLength(1);
  });

  it('does not record a player for a HEAD request', async () => {
    clearActivePlayers();
    const res = await app.inject({
      method: 'HEAD',
      url: query('/rest/stream.view?id=song-1', 'json'),
    });
    expect(res.statusCode).toBe(200);
    expect(getActivePlayers()).toHaveLength(0);
  });

  it('returns 404 when streaming a missing song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/stream.view?id=missing', 'json') });
    expect(res.statusCode).toBe(404);
  });

  it('downloads an existing song as the full file', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/download.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.rawPayload.length).toBe(fixtureBytes.length);
  });

  it('sets the download filename from the file path basename', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/download.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="sample.mp3"');
  });

  it('returns 404 when downloading a missing song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/download.view?id=missing', 'json') });
    expect(res.statusCode).toBe(404);
  });

  it('returns a Subsonic error for cover art when the file has none', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getCoverArt.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });

  it('returns a Subsonic error for cover art of a missing song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getCoverArt.view?id=missing', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });

  it('returns a Subsonic error for cover art when the file cannot be read', async () => {
    upsertSong(db, {
      id: 'song-missing-file',
      filePath: '/data/library/does-not-exist.mp3',
      title: 'Missing File Song',
      duration: 1,
      mtime: Date.now(),
      checksum: 'checksum-missing',
    });

    const res = await app.inject({ method: 'GET', url: query('/rest/getCoverArt.view?id=song-missing-file', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });
});
