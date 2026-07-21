import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { registerOpenSubsonicRoutes } from '../../src/opensubsonic/routes/system.js';
import { migrate } from '../../src/db/migrate.js';
import { createUser } from '../../src/db/repositories/user-repository.js';
import { upsertArtist } from '../../src/db/repositories/artist-repository.js';
import { upsertAlbum } from '../../src/db/repositories/album-repository.js';
import { upsertSong } from '../../src/db/repositories/song-repository.js';
import { buildSubsonicToken } from '../../src/auth/token.js';
import { generateApiKey, storeApiKey } from '../../src/auth/api-keys.js';
import type { Config } from '../../src/config.js';

const config: Config = {
  PORT: 3000,
  NODE_ENV: 'test',
  SESSION_SECRET: 'a-secret-key-that-is-long-enough-for-the-session-secret-32',
  SESSION_COOKIE_SECURE: false,
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

function seedCatalog(db: Database.Database) {
  upsertArtist(db, { id: 'artist-1', name: 'Alpha Artist' });
  upsertArtist(db, { id: 'artist-2', name: 'Another Artist' });
  upsertArtist(db, { id: 'artist-3', name: 'Beta Band' });
  upsertAlbum(db, {
    id: 'album-1',
    name: 'First Album',
    artistId: 'artist-1',
    artistName: 'Alpha Artist',
    year: 2024,
    genre: 'Rock',
  });
  upsertSong(db, {
    id: 'song-1',
    filePath: '/data/library/song1.mp3',
    title: 'Track One',
    trackNumber: 1,
    discNumber: 1,
    duration: 180,
    artistId: 'artist-1',
    albumId: 'album-1',
    genre: 'Rock',
    year: 2024,
    mtime: Date.now(),
    checksum: 'checksum-1',
  });
  upsertSong(db, {
    id: 'song-2',
    filePath: '/data/library/song2.mp3',
    title: 'Track Two',
    trackNumber: 2,
    discNumber: 1,
    duration: 200,
    artistId: 'artist-1',
    albumId: 'album-1',
    genre: 'Rock',
    year: 2024,
    mtime: Date.now(),
    checksum: 'checksum-2',
  });
}

describe('OpenSubsonic system endpoints', () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;
  let auth: ReturnType<typeof seedUser>;

  beforeEach(async () => {
    db = new Database(':memory:');
    migrate(db);
    auth = seedUser(db);
    app = Fastify();
    await registerOpenSubsonicRoutes(app, config, db);
  });

  afterEach(() => {
    db.close();
  });

  function query(url: string, format: 'json' | 'xml' = 'json') {
    return `${url}&u=${auth.username}&t=${auth.token}&s=${auth.salt}&f=${format}`;
  }

  it('responds to ping with JSON envelope', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/ping.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
    expect(body['subsonic-response'].version).toBe('1.16.1');
    expect(body['subsonic-response'].type).toBe('sonarly');
    expect(body['subsonic-response'].serverVersion).toBe('0.1.0');
  });

  it('responds to ping with XML envelope', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/ping.view?', 'xml') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.body).toContain('<subsonic-response');
    expect(res.body).toContain('<status>ok</status>');
  });

  it('rejects requests without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/rest/ping.view?f=json' });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].version).toBe('1.16.1');
    expect(body['subsonic-response'].type).toBe('sonarly');
    expect(body['subsonic-response'].serverVersion).toBe('0.1.0');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects requests with invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/rest/ping.view?u=${auth.username}&t=bad&s=${auth.salt}&f=json`,
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(40);
  });

  it('authenticates with an API key query parameter', async () => {
    const apiKey = generateApiKey();
    storeApiKey(db, 'user-1', apiKey);
    const res = await app.inject({ method: 'GET', url: `/rest/ping.view?apiKey=${apiKey}&f=json` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
  });

  it('authenticates with an X-API-Key header', async () => {
    const apiKey = generateApiKey();
    storeApiKey(db, 'user-1', apiKey);
    const res = await app.inject({
      method: 'GET',
      url: '/rest/ping.view?f=json',
      headers: { 'X-API-Key': apiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
  });

  it('rejects an invalid API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/rest/ping.view?apiKey=sk_invalid&f=json' });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(40);
  });

  it('returns a valid license', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getLicense.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].license.valid).toBe(true);
  });
});

describe('OpenSubsonic browsing endpoints', () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;
  let auth: ReturnType<typeof seedUser>;

  beforeEach(async () => {
    db = new Database(':memory:');
    migrate(db);
    auth = seedUser(db);
    seedCatalog(db);
    app = Fastify();
    await registerOpenSubsonicRoutes(app, config, db);
  });

  afterEach(() => {
    db.close();
  });

  function query(url: string, format: 'json' | 'xml' = 'json') {
    return `${url}&u=${auth.username}&t=${auth.token}&s=${auth.salt}&f=${format}`;
  }

  it('returns music folders derived from library path', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getMusicFolders.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].musicFolders.musicFolder).toEqual([{ id: 0, name: 'library' }]);
  });

  it('returns indexes grouped by artist initial', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getIndexes.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const indexes = body['subsonic-response'].indexes;
    expect(typeof indexes.lastModified).toBe('number');
    expect(indexes.index).toHaveLength(2);
    const indexA = indexes.index.find((i: { name: string }) => i.name === 'A');
    const indexB = indexes.index.find((i: { name: string }) => i.name === 'B');
    expect(indexA).toBeDefined();
    expect(indexA.artist).toHaveLength(2);
    expect(indexA.artist.map((a: { name: string }) => a.name).sort()).toEqual(['Alpha Artist', 'Another Artist']);
    expect(indexB).toBeDefined();
    expect(indexB.artist).toHaveLength(1);
    expect(indexB.artist[0].name).toBe('Beta Band');
  });

  it('returns artists grouped by initial', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getArtists.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].artists.index).toHaveLength(2);
    const indexA = body['subsonic-response'].artists.index.find((i: { name: string }) => i.name === 'A');
    expect(indexA.artist).toHaveLength(2);
  });

  it('returns an album with its songs', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getAlbum.view?id=album-1', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].album.name).toBe('First Album');
    expect(body['subsonic-response'].album.artist).toBe('Alpha Artist');
    expect(body['subsonic-response'].album.song).toHaveLength(2);
    expect(body['subsonic-response'].album.song[0].title).toBe('Track One');
    expect(body['subsonic-response'].album.song[0].album).toBe('First Album');
    expect(body['subsonic-response'].album.song[0].artist).toBe('Alpha Artist');
    expect(body['subsonic-response'].album.song[0].albumId).toBe('album-1');
    expect(body['subsonic-response'].album.song[0].artistId).toBe('artist-1');
  });

  it('returns a controlled error for a missing album', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getAlbum.view?id=missing', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });

  it('returns a single song with names and ids', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getSong.view?id=song-1', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].song.id).toBe('song-1');
    expect(body['subsonic-response'].song.title).toBe('Track One');
    expect(body['subsonic-response'].song.type).toBe('music');
    expect(body['subsonic-response'].song.album).toBe('First Album');
    expect(body['subsonic-response'].song.artist).toBe('Alpha Artist');
    expect(body['subsonic-response'].song.albumId).toBe('album-1');
    expect(body['subsonic-response'].song.artistId).toBe('artist-1');
  });

  it('returns a controlled error for a missing song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getSong.view?id=missing', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });
});
