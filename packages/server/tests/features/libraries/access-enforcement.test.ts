import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { buildSubsonicToken } from '../../../src/features/auth/token.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';
import { upsertAlbum } from '../../../src/features/albums/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { createLibrary, assignLibrariesToUser } from '../../../src/features/libraries/repository.js';
import { createPlaylist } from '../../../src/features/playlists/repository.js';
import { login } from '../../integration/helpers.js';
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

const SHARE_TOKEN = 'share-token-123';

function subsonicUrl(username: string, password: string, path: string): string {
  const salt = 'salty';
  const token = buildSubsonicToken(password, salt);
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}u=${username}&t=${token}&s=${salt}&f=json`;
}

describe('library access enforcement', () => {
  let root: string;
  let config: Config;
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie: string;
  let aliceCookie: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-access-${Date.now()}`);
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

    // buildApp creates the default library; add two more for the matrix.
    app = await buildApp(config, db);

    const now = new Date().toISOString();
    const seed = async (id: string, username: string, password: string, isAdmin: boolean) => {
      createUser(db, {
        id,
        username,
        passwordHash: await hashPassword(password),
        subsonicPasswordEncrypted: encryptSubsonicPassword(password, config.SESSION_SECRET),
        isAdmin,
        createdAt: now,
      });
    };
    await seed('user-admin', 'admin', 'adminpass', true);
    await seed('user-alice', 'alice', 'alicepass', false);
    await seed('user-bob', 'bob', 'bobpass', false);
    await seed('user-carol', 'carol', 'carolpass', false);

    createLibrary(db, {
      id: 'lib-1',
      name: 'Library One',
      path: join(root, 'lib1'),
      organizePattern: '{artist}/{title}',
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    createLibrary(db, {
      id: 'lib-2',
      name: 'Library Two',
      path: join(root, 'lib2'),
      organizePattern: '{artist}/{title}',
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    assignLibrariesToUser(db, 'user-alice', ['lib-1']);
    assignLibrariesToUser(db, 'user-bob', ['lib-2']);
    // carol intentionally has no assignments.

    upsertArtist(db, { id: 'artist-1', name: 'Alpha Artist' });
    upsertArtist(db, { id: 'artist-2', name: 'Beta Artist' });
    upsertAlbum(db, { id: 'album-1', name: 'Alpha Album', artistId: 'artist-1', artistName: 'Alpha Artist', year: 2020 });
    upsertAlbum(db, { id: 'album-2', name: 'Beta Album', artistId: 'artist-2', artistName: 'Beta Artist', year: 2021 });

    const lib1Dir = mkdtempSync(join(tmpdir(), 'sonarly-lib1-'));
    const lib2Dir = mkdtempSync(join(tmpdir(), 'sonarly-lib2-'));
    const file1 = join(lib1Dir, 'alpha.mp3');
    const file2 = join(lib2Dir, 'beta.mp3');
    copyFileSync(fixturePath, file1);
    copyFileSync(fixturePath, file2);
    upsertSong(db, {
      id: 'song-1',
      filePath: file1,
      title: 'Alpha Track',
      artistId: 'artist-1',
      albumId: 'album-1',
      libraryId: 'lib-1',
      year: 2020,
      mtime: Date.now(),
      checksum: 'cs-1',
    });
    upsertSong(db, {
      id: 'song-2',
      filePath: file2,
      title: 'Beta Track',
      artistId: 'artist-2',
      albumId: 'album-2',
      libraryId: 'lib-2',
      year: 2021,
      mtime: Date.now(),
      checksum: 'cs-2',
    });

    createPlaylist(db, {
      id: 'playlist-1',
      name: 'Shared',
      ownerId: 'user-alice',
      visibility: 'link',
      shareToken: SHARE_TOKEN,
      songIds: ['song-2'],
      isSmart: false,
      createdAt: now,
      updatedAt: now,
    });

    adminCookie = await login(app, 'admin', 'adminpass');
    aliceCookie = await login(app, 'alice', 'alicepass');
    await login(app, 'bob', 'bobpass');
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('hides out-of-scope song detail with 404', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: '/api/songs/song-2',
      cookies: { sessionId: aliceCookie },
    });
    expect(denied.statusCode).toBe(404);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/songs/song-1',
      cookies: { sessionId: aliceCookie },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('blocks streaming out-of-scope songs with 404', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: '/api/stream/song-2',
      cookies: { sessionId: aliceCookie },
    });
    expect(denied.statusCode).toBe(404);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/stream/song-1',
      cookies: { sessionId: aliceCookie },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('excludes out-of-scope content from lists and search', async () => {
    const songs = await app.inject({
      method: 'GET',
      url: '/api/songs',
      cookies: { sessionId: aliceCookie },
    });
    expect(songs.statusCode).toBe(200);
    const songIds = JSON.parse(songs.body).songs.map((s: { id: string }) => s.id);
    expect(songIds).toEqual(['song-1']);

    const albums = await app.inject({
      method: 'GET',
      url: '/api/albums',
      cookies: { sessionId: aliceCookie },
    });
    const albumIds = JSON.parse(albums.body).albums.map((a: { id: string }) => a.id);
    expect(albumIds).toEqual(['album-1']);

    const artists = await app.inject({
      method: 'GET',
      url: '/api/artists',
      cookies: { sessionId: aliceCookie },
    });
    const artistIds = JSON.parse(artists.body).artists.map((a: { id: string }) => a.id);
    expect(artistIds).toEqual(['artist-1']);

    const search = await app.inject({
      method: 'GET',
      url: '/api/search?q=Track',
      cookies: { sessionId: aliceCookie },
    });
    const searchBody = JSON.parse(search.body);
    expect(searchBody.songs.map((s: { id: string }) => s.id)).toEqual(['song-1']);
    expect(searchBody.albums).toEqual([]);
    expect(searchBody.artists).toEqual([]);
  });

  it('scopes detail endpoints for albums, artists, lyrics, and years', async () => {
    const album = await app.inject({
      method: 'GET',
      url: '/api/albums/album-2',
      cookies: { sessionId: aliceCookie },
    });
    expect(album.statusCode).toBe(404);

    const artist = await app.inject({
      method: 'GET',
      url: '/api/artists/artist-2',
      cookies: { sessionId: aliceCookie },
    });
    expect(artist.statusCode).toBe(404);

    const artistSongs = await app.inject({
      method: 'GET',
      url: '/api/artists/artist-2/songs',
      cookies: { sessionId: aliceCookie },
    });
    expect(artistSongs.statusCode).toBe(404);

    const lyrics = await app.inject({
      method: 'GET',
      url: '/api/songs/song-2/lyrics',
      cookies: { sessionId: aliceCookie },
    });
    expect(lyrics.statusCode).toBe(404);

    const years = await app.inject({
      method: 'GET',
      url: '/api/years',
      cookies: { sessionId: aliceCookie },
    });
    expect(JSON.parse(years.body).years).toEqual([2020]);
  });

  it('scopes auto-dj and home to assigned libraries', async () => {
    const autoDj = await app.inject({
      method: 'GET',
      url: '/api/playback/auto-dj?mode=random&count=10',
      cookies: { sessionId: aliceCookie },
    });
    expect(autoDj.statusCode).toBe(200);
    const djIds = JSON.parse(autoDj.body).songs.map((s: { id: string }) => s.id);
    expect(djIds).toEqual(['song-1']);

    const home = await app.inject({
      method: 'GET',
      url: '/api/home',
      cookies: { sessionId: aliceCookie },
    });
    const homeBody = JSON.parse(home.body);
    const randomIds = homeBody.random.map((a: { id: string }) => a.id);
    expect(randomIds).toEqual(['album-1']);
  });

  it('shows only assigned libraries via getMusicFolders', async () => {
    const aliceRes = await app.inject({
      method: 'GET',
      url: subsonicUrl('alice', 'alicepass', '/rest/getMusicFolders.view?'),
    });
    expect(aliceRes.statusCode).toBe(200);
    const aliceFolders = JSON.parse(aliceRes.body)['subsonic-response'].musicFolders.musicFolder;
    expect(aliceFolders).toEqual([{ id: 0, name: 'Library One' }]);

    const adminRes = await app.inject({
      method: 'GET',
      url: subsonicUrl('admin', 'adminpass', '/rest/getMusicFolders.view?'),
    });
    const adminFolders = JSON.parse(adminRes.body)['subsonic-response'].musicFolders.musicFolder;
    expect(adminFolders.map((f: { name: string }) => f.name)).toContain('Library One');
    expect(adminFolders.map((f: { name: string }) => f.name)).toContain('Library Two');
  });

  it('blocks subsonic streaming and browsing of out-of-scope songs', async () => {
    const stream = await app.inject({
      method: 'GET',
      url: subsonicUrl('alice', 'alicepass', `/rest/stream.view?id=song-2`),
    });
    expect(stream.statusCode).toBe(404);

    const okStream = await app.inject({
      method: 'GET',
      url: subsonicUrl('alice', 'alicepass', `/rest/stream.view?id=song-1`),
    });
    expect(okStream.statusCode).toBe(200);

    const getSong = await app.inject({
      method: 'GET',
      url: subsonicUrl('alice', 'alicepass', `/rest/getSong.view?id=song-2`),
    });
    expect(JSON.parse(getSong.body)['subsonic-response'].status).toBe('failed');

    const search3 = await app.inject({
      method: 'GET',
      url: subsonicUrl('alice', 'alicepass', `/rest/search3.view?query=Track`),
    });
    const searchBody = JSON.parse(search3.body)['subsonic-response'].searchResult3;
    expect((searchBody.song ?? []).map((s: { id: string }) => s.id)).toEqual(['song-1']);
  });

  it('gives admins full access', async () => {
    const songs = await app.inject({
      method: 'GET',
      url: '/api/songs',
      cookies: { sessionId: adminCookie },
    });
    const songIds = JSON.parse(songs.body).songs.map((s: { id: string }) => s.id);
    expect(songIds).toContain('song-1');
    expect(songIds).toContain('song-2');

    const stream = await app.inject({
      method: 'GET',
      url: '/api/stream/song-2',
      cookies: { sessionId: adminCookie },
    });
    expect(stream.statusCode).toBe(200);
  });

  it('treats a user with no assignments as an empty library', async () => {
    const carolCookie = await login(app, 'carol', 'carolpass');
    const songs = await app.inject({
      method: 'GET',
      url: '/api/songs',
      cookies: { sessionId: carolCookie },
    });
    expect(JSON.parse(songs.body).songs).toEqual([]);

    const folders = await app.inject({
      method: 'GET',
      url: subsonicUrl('carol', 'carolpass', '/rest/getMusicFolders.view?'),
    });
    expect(JSON.parse(folders.body)['subsonic-response'].musicFolders.musicFolder).toEqual([]);
  });

  it('serves anonymous share-token streaming for out-of-scope playlist songs', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: '/api/stream/song-2',
    });
    expect(denied.statusCode).toBe(401);

    const shared = await app.inject({
      method: 'GET',
      url: `/api/stream/song-2?shareToken=${SHARE_TOKEN}`,
    });
    expect(shared.statusCode).toBe(200);
    expect(shared.rawPayload.length).toBeGreaterThan(0);
  });
});
