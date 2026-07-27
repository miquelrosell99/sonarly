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
  const rockId = getOrCreateGenreByName(db, 'Rock');
  const popId = getOrCreateGenreByName(db, 'Pop');
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
    bitRate: 320,
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
    bitRate: 320,
    artistId: 'artist-1',
    albumId: 'album-1',
    genre: 'Rock',
    genreId: rockId,
    year: 2024,
    mtime: Date.now(),
    checksum: 'checksum-2',
  });
  upsertSong(db, {
    id: 'song-3',
    filePath: '/data/library/song3.mp3',
    title: 'Pop Track',
    trackNumber: 1,
    discNumber: 1,
    duration: 210,
    bitRate: 256,
    artistId: 'artist-2',
    albumId: 'album-1',
    genre: 'Pop',
    genreId: popId,
    year: 2023,
    mtime: Date.now(),
    checksum: 'checksum-3',
  });
  db.prepare(`
    INSERT INTO album_genres (album_id, genre_id, position)
    VALUES ('album-1', ?, 0)
    ON CONFLICT(album_id, genre_id) DO NOTHING
  `).run(rockId);
  db.prepare(`
    INSERT INTO song_genres (song_id, genre_id, position)
    VALUES ('song-1', ?, 0), ('song-2', ?, 0), ('song-3', ?, 0)
    ON CONFLICT(song_id, genre_id) DO NOTHING
  `).run(rockId, rockId, popId);
  db.prepare(`
    INSERT INTO user_songs (user_id, song_id, play_count)
    VALUES ('user-1', 'song-1', 10), ('user-1', 'song-2', 5), ('user-1', 'song-3', 1)
    ON CONFLICT(user_id, song_id) DO UPDATE SET play_count = excluded.play_count
  `).run();
}

describe('OpenSubsonic extra browsing endpoints', () => {
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

  it('returns albums from legacy getAlbumList', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getAlbumList.view?type=alphabeticalByName&size=10&offset=0', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].albumList.album).toHaveLength(1);
    expect(body['subsonic-response'].albumList.album[0].name).toBe('First Album');
  });

  it('returns songs from getSongsByGenre', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getSongsByGenre.view?genre=Rock&size=10&offset=0', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].songsByGenre.song).toHaveLength(2);
    expect(body['subsonic-response'].songsByGenre.song.map((s: { title: string }) => s.title).sort()).toEqual(['Track One', 'Track Two']);
  });

  it('returns random songs from getRandomSongs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getRandomSongs.view?size=10', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].randomSongs.song).toHaveLength(3);
  });

  it('filters random songs by genre', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getRandomSongs.view?size=10&genre=Pop', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].randomSongs.song).toHaveLength(1);
    expect(body['subsonic-response'].randomSongs.song[0].title).toBe('Pop Track');
  });

  it('returns artist info from getArtistInfo2', async () => {
    db.prepare("UPDATE artists SET musicbrainz_artist_ids = ? WHERE id = 'artist-1'").run(JSON.stringify(['mb-artist-1']));
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getArtistInfo2.view?id=artist-1&count=5', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].artistInfo2.biography).toBe('');
    expect(body['subsonic-response'].artistInfo2.musicBrainzId).toBe('mb-artist-1');
    expect(Array.isArray(body['subsonic-response'].artistInfo2.similarArtists)).toBe(true);
  });

  it('returns album info from getAlbumInfo2', async () => {
    db.prepare("UPDATE albums SET musicbrainz_album_id = 'mb-album-1' WHERE id = 'album-1'").run();
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getAlbumInfo2.view?id=album-1', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].albumInfo2.notes).toBe('');
    expect(body['subsonic-response'].albumInfo2.musicBrainzId).toBe('mb-album-1');
  });

  it('returns similar songs from getSimilarSongs2', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getSimilarSongs2.view?id=song-1&count=10', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const titles = body['subsonic-response'].similarSongs2.song.map((s: { title: string }) => s.title);
    expect(titles).not.toContain('Track One');
    expect(titles).toContain('Track Two');
  });

  it('returns top songs from getTopSongs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/getTopSongs.view?artist=Alpha%20Artist&count=10', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].topSongs.song).toHaveLength(2);
    expect(body['subsonic-response'].topSongs.song[0].title).toBe('Track One');
  });

  it('returns a controlled error for a missing artist info', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getArtistInfo2.view?id=missing', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(70);
  });
});
