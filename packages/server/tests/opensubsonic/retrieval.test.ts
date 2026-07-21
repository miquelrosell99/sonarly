import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
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

const fixturePath = fileURLToPath(new URL('../fixtures/sample.mp3', import.meta.url));
const fixtureBytes = readFileSync(fixturePath);

function seedUser(db: Database.Database) {
  const username = 'tester';
  const passwordHash = 'supersecret';
  const salt = 'salty';
  const token = buildSubsonicToken(passwordHash, salt);
  createUser(db, { id: 'user-1', username, passwordHash, isAdmin: false, createdAt: new Date().toISOString() });
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
    db = new Database(':memory:');
    migrate(db);
    auth = seedUser(db);
    seedSong(db);
    app = Fastify();
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

  it('returns 404 when downloading a missing song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/download.view?id=missing', 'json') });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for cover art when the file has none', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getCoverArt.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for cover art of a missing song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getCoverArt.view?id=missing', 'json') });
    expect(res.statusCode).toBe(404);
  });
});
