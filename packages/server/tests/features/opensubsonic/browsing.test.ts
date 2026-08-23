import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { registerOpenSubsonicRoutes } from '../../../src/features/opensubsonic/routes/system.js';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';
import { upsertAlbum } from '../../../src/features/albums/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { getOrCreateGenreByName } from '../../../src/features/genres/repository.js';
import { buildSubsonicToken } from '../../../src/features/auth/token.js';
import { encryptSubsonicPassword, hashPassword } from '../../../src/features/auth/password.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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

async function seedUser(db: Database.Database) {
  const username = 'tester';
  const password = 'supersecret';
  const subsonicPasswordEncrypted = encryptSubsonicPassword(password, config.SESSION_SECRET);
  const passwordHash = await hashPassword(password);
  const salt = 'salty';
  const token = buildSubsonicToken(password, salt);
  createUser(db, { id: 'user-1', username, passwordHash, subsonicPasswordEncrypted, isAdmin: false, createdAt: new Date().toISOString() });
  return { username, token, salt, password };
}

function seedCatalog(db: Database.Database) {
  upsertArtist(db, { id: 'artist-1', name: 'Alpha Artist' });
  upsertArtist(db, { id: 'artist-2', name: 'Another Artist' });
  upsertArtist(db, { id: 'artist-3', name: 'Beta Band' });
  const rockId = getOrCreateGenreByName(db, 'Rock');
  upsertAlbum(db, {
    id: 'album-1',
    name: 'First Album',
    artistId: 'artist-1',
    artistName: 'Alpha Artist',
    year: 2024,
    genre: 'Rock',
    genreId: rockId,
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
    genreId: rockId,
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
    genreId: rockId,
    year: 2024,
    mtime: Date.now(),
    checksum: 'checksum-2',
  });
  db.prepare(`
    INSERT INTO album_genres (album_id, genre_id, position)
    VALUES ('album-1', ?, 0)
    ON CONFLICT(album_id, genre_id) DO NOTHING
  `).run(rockId);
  db.prepare(`
    INSERT INTO song_genres (song_id, genre_id, position)
    VALUES ('song-1', ?, 0), ('song-2', ?, 0)
    ON CONFLICT(song_id, genre_id) DO NOTHING
  `).run(rockId, rockId);
}

function seedApiKey(db: Database.Database): string {
  const apiKey = 'sk_' + randomBytes(32).toString('hex');
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  db.prepare('INSERT INTO api_keys (id, user_id, key_hash) VALUES (?, ?, ?)').run(randomUUID(), 'user-1', keyHash);
  return apiKey;
}

describe('OpenSubsonic system endpoints', () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;
  let auth: ReturnType<typeof seedUser>;

  beforeEach(async () => {
    db = new Database(':memory:');
    migrate(db);
    auth = await seedUser(db);
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
    expect(body['subsonic-response'].openSubsonic).toBe(true);
  });

  it('responds to ping with XML envelope', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/ping.view?', 'xml') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.body).toContain('<subsonic-response');
    expect(res.body).toContain('status="ok"');
    expect(res.body).toContain('openSubsonic="true"');
  });

  it('rejects requests without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/rest/ping.view?f=json' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].version).toBe('1.16.1');
    expect(body['subsonic-response'].type).toBe('sonarly');
    expect(body['subsonic-response'].serverVersion).toBe('0.1.0');
    expect(body['subsonic-response'].openSubsonic).toBe(true);
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects requests with invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/rest/ping.view?u=${auth.username}&t=bad&s=${auth.salt}&f=json`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(40);
  });

  it('authenticates with an API key query parameter', async () => {
    const apiKey = seedApiKey(db);
    const res = await app.inject({ method: 'GET', url: `/rest/ping.view?apiKey=${apiKey}&f=json` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
  });

  it('authenticates with an X-API-Key header', async () => {
    const apiKey = seedApiKey(db);
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
    expect(res.statusCode).toBe(200);
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

  it('returns openSubsonic extensions list', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getOpenSubsonicExtensions.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].openSubsonicExtensions).toEqual([]);
  });

  it('returns the authenticated user from getUser', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getUser.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
    expect(body['subsonic-response'].user.username).toBe(auth.username);
    expect(body['subsonic-response'].user.adminRole).toBe(false);
    expect(body['subsonic-response'].user.streamRole).toBe(true);
    expect(body['subsonic-response'].user.folder).toEqual(['0']);
  });

  it('rejects legacy plaintext password auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/rest/ping.view?u=${auth.username}&p=${auth.password}&f=json`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });

  it('rejects hex-encoded legacy password auth', async () => {
    const hexPassword = Buffer.from(auth.password).toString('hex');
    const res = await app.inject({
      method: 'GET',
      url: `/rest/ping.view?u=${auth.username}&p=enc:${hexPassword}&f=json`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(10);
  });
});

describe('OpenSubsonic browsing endpoints', () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;
  let auth: ReturnType<typeof seedUser>;

  beforeEach(async () => {
    db = new Database(':memory:');
    migrate(db);
    auth = await seedUser(db);
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

  it('returns libraries from the database when configured', async () => {
    db.prepare("INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run('lib-1', 'Music', '/media/music', '2024-01-01', '2024-01-01');
    db.prepare("INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run('lib-2', 'Audiobooks', '/media/audiobooks', '2024-01-01', '2024-01-01');

    const res = await app.inject({ method: 'GET', url: query('/rest/getMusicFolders.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].musicFolders.musicFolder).toEqual([
      { id: 0, name: 'Audiobooks' },
      { id: 1, name: 'Music' },
    ]);
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
    expect(indexA.artist[0]).toHaveProperty('coverArt');
    expect(indexA.artist[0]).toHaveProperty('albumCount');
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
    expect(indexA.artist[0]).toHaveProperty('coverArt');
    expect(indexA.artist[0]).toHaveProperty('albumCount');
  });

  it('returns an album with its songs', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getAlbum.view?id=album-1', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const album = body['subsonic-response'].album;
    expect(album.name).toBe('First Album');
    expect(album.title).toBe('First Album');
    expect(album.album).toBe('First Album');
    expect(album.artist).toBe('Alpha Artist');
    expect(album.artistId).toBe('artist-1');
    expect(album.isDir).toBe(true);
    expect(album.parent).toBe('artist-1');
    expect(album.songCount).toBe(2);
    expect(album.duration).toBe(380);
    expect(album.song).toHaveLength(2);
    const song = album.song[0];
    expect(song.title).toBe('Track One');
    expect(song.album).toBe('First Album');
    expect(song.artist).toBe('Alpha Artist');
    expect(song.albumId).toBe('album-1');
    expect(song.artistId).toBe('artist-1');
    expect(song.isDir).toBe(false);
    expect(song.isVideo).toBe(false);
    expect(song.contentType).toBe('audio/mpeg');
    expect(song.suffix).toBe('mp3');
    expect(song.path).toBe('song1.mp3');
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
    const song = body['subsonic-response'].song;
    expect(song.id).toBe('song-1');
    expect(song.title).toBe('Track One');
    expect(song.type).toBe('music');
    expect(song.album).toBe('First Album');
    expect(song.artist).toBe('Alpha Artist');
    expect(song.albumId).toBe('album-1');
    expect(song.artistId).toBe('artist-1');
    expect(song.isDir).toBe(false);
    expect(song.isVideo).toBe(false);
    expect(song.contentType).toBe('audio/mpeg');
    expect(song.suffix).toBe('mp3');
    expect(song.path).toBe('song1.mp3');
  });

  it('returns a controlled error for a missing song', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getSong.view?id=missing', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });

  it('returns an artist with their albums', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getArtist.view?id=artist-1', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].artist.name).toBe('Alpha Artist');
    expect(body['subsonic-response'].artist.albumCount).toBe(1);
    expect(body['subsonic-response'].artist.album).toHaveLength(1);
    expect(body['subsonic-response'].artist.album[0].name).toBe('First Album');
    expect(body['subsonic-response'].artist.album[0].songCount).toBe(2);
    expect(body['subsonic-response'].artist.album[0].duration).toBe(380);
  });

  it('returns a controlled error for a missing artist', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getArtist.view?id=missing', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });

  it('returns albums from getAlbumList2', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getAlbumList2.view?type=alphabeticalByName&size=10&offset=0', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].albumList2.album).toHaveLength(1);
    expect(body['subsonic-response'].albumList2.album[0].name).toBe('First Album');
    expect(body['subsonic-response'].albumList2.album[0].songCount).toBe(2);
    expect(body['subsonic-response'].albumList2.album[0].duration).toBe(380);
  });

  it('returns genres from getGenres', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getGenres.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].genres.genre).toHaveLength(1);
    expect(body['subsonic-response'].genres.genre[0].value).toBe('Rock');
  });

  it('returns empty bookmarks from getBookmarks', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getBookmarks.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].bookmarks.bookmark).toHaveLength(0);
  });

  it('returns search results from search3', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/search3.view?query=Track&artistCount=10&albumCount=10&songCount=10', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].searchResult3.song).toHaveLength(2);
  });

  it('returns all results from search3 with an empty query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/search3.view?query=&artistCount=10&albumCount=10&songCount=10', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].searchResult3.artist).toHaveLength(3);
    expect(body['subsonic-response'].searchResult3.artist[0].albumCount).toBe(1);
    expect(body['subsonic-response'].searchResult3.album).toHaveLength(1);
    expect(body['subsonic-response'].searchResult3.song).toHaveLength(2);
  });

  it('treats a quoted empty query as a request for all results', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/search3.view?query=%22%22&artistCount=10&albumCount=10&songCount=10', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].searchResult3.artist).toHaveLength(3);
    expect(body['subsonic-response'].searchResult3.album).toHaveLength(1);
    expect(body['subsonic-response'].searchResult3.song).toHaveLength(2);
  });
});
