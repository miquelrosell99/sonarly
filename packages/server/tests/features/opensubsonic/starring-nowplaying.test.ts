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
import { clearActivePlayers } from '../../../src/features/players/tracker.js';
import type { Config } from '../../../src/config.js';

const samplePath = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;

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
    filePath: samplePath,
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
  db.prepare(`
    INSERT INTO album_genres (album_id, genre_id, position)
    VALUES ('album-1', ?, 0)
    ON CONFLICT(album_id, genre_id) DO NOTHING
  `).run(rockId);
  db.prepare(`
    INSERT INTO song_genres (song_id, genre_id, position)
    VALUES ('song-1', ?, 0)
    ON CONFLICT(song_id, genre_id) DO NOTHING
  `).run(rockId);
}

describe('OpenSubsonic starring and now-playing endpoints', () => {
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
    clearActivePlayers();
    db.close();
  });

  function query(url: string, format: 'json' | 'xml' = 'json') {
    return `${url}&u=${auth.username}&t=${auth.token}&s=${auth.salt}&f=${format}`;
  }

  it('returns starred items from getStarred2', async () => {
    db.prepare("INSERT INTO user_songs (user_id, song_id, starred) VALUES ('user-1', 'song-1', 1)").run();
    db.prepare("INSERT INTO user_albums (user_id, album_id, starred) VALUES ('user-1', 'album-1', 1)").run();
    db.prepare("INSERT INTO user_artists (user_id, artist_id, starred) VALUES ('user-1', 'artist-1', 1)").run();

    const res = await app.inject({ method: 'GET', url: query('/rest/getStarred2.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].starred2.song).toHaveLength(1);
    expect(body['subsonic-response'].starred2.song[0].id).toBe('song-1');
    expect(body['subsonic-response'].starred2.album).toHaveLength(1);
    expect(body['subsonic-response'].starred2.album[0].id).toBe('album-1');
    expect(body['subsonic-response'].starred2.artist).toHaveLength(1);
    expect(body['subsonic-response'].starred2.artist[0].id).toBe('artist-1');
  });

  it('returns empty starred2 when nothing is starred', async () => {
    const res = await app.inject({ method: 'GET', url: query('/rest/getStarred2.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].starred2.song).toHaveLength(0);
    expect(body['subsonic-response'].starred2.album).toHaveLength(0);
    expect(body['subsonic-response'].starred2.artist).toHaveLength(0);
  });

  it('returns now playing entries', async () => {
    await app.inject({
      method: 'GET',
      url: query('/rest/stream.view?id=song-1', 'json'),
    });

    const res = await app.inject({ method: 'GET', url: query('/rest/getNowPlaying.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].nowPlaying.entry).toHaveLength(1);
    expect(body['subsonic-response'].nowPlaying.entry[0].entry.id).toBe('song-1');
    expect(body['subsonic-response'].nowPlaying.entry[0].username).toBe(auth.username);
  });
});
