import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { registerOpenSubsonicRoutes } from '../../src/opensubsonic/routes/system.js';
import { migrate } from '../../src/db/migrate.js';
import { createUser } from '../../src/db/repositories/user-repository.js';
import { upsertSong } from '../../src/db/repositories/song-repository.js';
import { buildSubsonicToken } from '../../src/auth/token.js';
import { hashSubsonicPassword } from '../../src/auth/password.js';
import { sharePlaylistWithUser } from '../../src/db/repositories/playlist-repository.js';
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

function seedUser(db: Database.Database, id: string, username: string) {
  const password = 'supersecret';
  const subsonicPasswordHash = hashSubsonicPassword(password);
  const salt = `salty-${id}`;
  const token = buildSubsonicToken(subsonicPasswordHash, salt);
  createUser(db, { id, username, passwordHash: 'ignored', subsonicPasswordHash, isAdmin: false, createdAt: new Date().toISOString() });
  return { id, username, token, salt };
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
  upsertSong(db, {
    id: 'song-3',
    filePath: '/data/library/song3.mp3',
    title: 'Track Three',
    duration: 220,
    mtime: Date.now(),
    checksum: 'checksum-3',
  });
}

describe('OpenSubsonic playlist endpoints', () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;
  let auth: ReturnType<typeof seedUser>;

  beforeEach(async () => {
    db = new Database(':memory:');
    migrate(db);
    auth = seedUser(db, 'user-1', 'tester');
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

  function otherQuery(user: ReturnType<typeof seedUser>, url: string, format: 'json' | 'xml' = 'json') {
    return `${url}&u=${user.username}&t=${user.token}&s=${user.salt}&f=${format}`;
  }

  it('creates a playlist and returns ok', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createPlaylist.view?name=My%20Playlist&songId=song-1&songId=song-2', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
  });

  it('creates a playlist using the first element when name is supplied as an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: query('/rest/createPlaylist.view?name=First&name=Second&songId=song-1', 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
    expect(body['subsonic-response'].playlist.name).toBe('First');
  });

  it('lists owned playlists via getPlaylists', async () => {
    await app.inject({
      method: 'GET',
      url: query('/rest/createPlaylist.view?name=Owned&songId=song-1', 'json'),
    });
    const res = await app.inject({ method: 'GET', url: query('/rest/getPlaylists.view?', 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const playlists = body['subsonic-response'].playlists.playlist;
    expect(playlists).toHaveLength(1);
    expect(playlists[0].name).toBe('Owned');
    expect(playlists[0].owner).toBe('user-1');
    expect(playlists[0].songCount).toBe(1);
  });

  it('returns a single playlist with entry array via getPlaylist', async () => {
    const createRes = await app.inject({
      method: 'GET',
      url: query('/rest/createPlaylist.view?name=Detailed&songId=song-1&songId=song-2', 'json'),
    });
    const createBody = JSON.parse(createRes.body);
    const id = createBody['subsonic-response'].playlist?.id;
    expect(id).toBeDefined();

    const res = await app.inject({ method: 'GET', url: query(`/rest/getPlaylist.view?id=${id}`, 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const playlist = body['subsonic-response'].playlist;
    expect(playlist.name).toBe('Detailed');
    expect(playlist.songCount).toBe(2);
    expect(playlist.entry).toHaveLength(2);
  });

  it('updates a playlist name and replaces song list', async () => {
    const createRes = await app.inject({
      method: 'GET',
      url: query('/rest/createPlaylist.view?name=Old&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;

    const res = await app.inject({
      method: 'GET',
      url: query(`/rest/updatePlaylist.view?playlistId=${id}&name=New&songId=song-2&songId=song-3`, 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');

    const getRes = await app.inject({ method: 'GET', url: query(`/rest/getPlaylist.view?id=${id}`, 'json') });
    const playlist = JSON.parse(getRes.body)['subsonic-response'].playlist;
    expect(playlist.name).toBe('New');
    expect(playlist.songCount).toBe(2);
    expect(playlist.entry.map((e: { id: string }) => e.id)).toEqual(['song-2', 'song-3']);
  });

  it('updates a playlist using the first element when name is supplied as an array', async () => {
    const createRes = await app.inject({
      method: 'GET',
      url: query('/rest/createPlaylist.view?name=Old&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;

    const res = await app.inject({
      method: 'GET',
      url: query(`/rest/updatePlaylist.view?playlistId=${id}&name=ArrayName1&name=ArrayName2`, 'json'),
    });
    expect(res.statusCode).toBe(200);

    const getRes = await app.inject({ method: 'GET', url: query(`/rest/getPlaylist.view?id=${id}`, 'json') });
    const playlist = JSON.parse(getRes.body)['subsonic-response'].playlist;
    expect(playlist.name).toBe('ArrayName1');
  });

  it('deletes a playlist', async () => {
    const createRes = await app.inject({
      method: 'GET',
      url: query('/rest/createPlaylist.view?name=ToDelete&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;

    const res = await app.inject({
      method: 'GET',
      url: query(`/rest/deletePlaylist.view?id=${id}`, 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');

    const getRes = await app.inject({ method: 'GET', url: query(`/rest/getPlaylist.view?id=${id}`, 'json') });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body)['subsonic-response'].playlist).toBeUndefined();
  });

  it('includes public playlists from other users in getPlaylists', async () => {
    const other = seedUser(db, 'user-2', 'other');
    await app.inject({
      method: 'GET',
      url: `/rest/createPlaylist.view?name=Public&visibility=public&u=${other.username}&t=${other.token}&s=${other.salt}&f=json`,
    });

    const res = await app.inject({ method: 'GET', url: query('/rest/getPlaylists.view?', 'json') });
    const playlists = JSON.parse(res.body)['subsonic-response'].playlists.playlist;
    expect(playlists).toHaveLength(1);
    expect(playlists[0].name).toBe('Public');
    expect(playlists[0].public).toBe(true);
  });

  it('does not include private playlists from other users in getPlaylists', async () => {
    const other = seedUser(db, 'user-2', 'other');
    await app.inject({
      method: 'GET',
      url: `/rest/createPlaylist.view?name=Private&visibility=private&u=${other.username}&t=${other.token}&s=${other.salt}&f=json`,
    });

    const res = await app.inject({ method: 'GET', url: query('/rest/getPlaylists.view?', 'json') });
    const playlists = JSON.parse(res.body)['subsonic-response'].playlists.playlist;
    expect(playlists).toHaveLength(0);
  });

  it('denies a non-owner view of a private playlist', async () => {
    const other = seedUser(db, 'user-2', 'other');
    const createRes = await app.inject({
      method: 'GET',
      url: otherQuery(other, '/rest/createPlaylist.view?name=Private&visibility=private&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;

    const res = await app.inject({ method: 'GET', url: query(`/rest/getPlaylist.view?id=${id}`, 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(50);
  });

  it('allows a shared user to view a private playlist', async () => {
    const other = seedUser(db, 'user-2', 'other');
    const createRes = await app.inject({
      method: 'GET',
      url: otherQuery(other, '/rest/createPlaylist.view?name=Shared&visibility=private&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;
    sharePlaylistWithUser(db, id, auth.id, false);

    const res = await app.inject({ method: 'GET', url: query(`/rest/getPlaylist.view?id=${id}`, 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');
    expect(body['subsonic-response'].playlist.name).toBe('Shared');
  });

  it('denies a shared user without can_edit from updating a playlist', async () => {
    const other = seedUser(db, 'user-2', 'other');
    const createRes = await app.inject({
      method: 'GET',
      url: otherQuery(other, '/rest/createPlaylist.view?name=Shared&visibility=private&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;
    sharePlaylistWithUser(db, id, auth.id, false);

    const res = await app.inject({
      method: 'GET',
      url: query(`/rest/updatePlaylist.view?playlistId=${id}&name=Hacked`, 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(50);
  });

  it('allows a shared user with can_edit to update a playlist', async () => {
    const other = seedUser(db, 'user-2', 'other');
    const createRes = await app.inject({
      method: 'GET',
      url: otherQuery(other, '/rest/createPlaylist.view?name=Shared&visibility=private&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;
    sharePlaylistWithUser(db, id, auth.id, true);

    const res = await app.inject({
      method: 'GET',
      url: query(`/rest/updatePlaylist.view?playlistId=${id}&name=Updated`, 'json'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');

    const getRes = await app.inject({ method: 'GET', url: otherQuery(other, `/rest/getPlaylist.view?id=${id}`, 'json') });
    const playlist = JSON.parse(getRes.body)['subsonic-response'].playlist;
    expect(playlist.name).toBe('Updated');
  });

  it('denies a non-owner from deleting a playlist', async () => {
    const other = seedUser(db, 'user-2', 'other');
    const createRes = await app.inject({
      method: 'GET',
      url: otherQuery(other, '/rest/createPlaylist.view?name=Private&visibility=private&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;

    const res = await app.inject({ method: 'GET', url: query(`/rest/deletePlaylist.view?id=${id}`, 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('failed');
    expect(body['subsonic-response'].error.code).toBe(50);
  });

  it('allows a shared user with can_edit to delete a playlist', async () => {
    const other = seedUser(db, 'user-2', 'other');
    const createRes = await app.inject({
      method: 'GET',
      url: otherQuery(other, '/rest/createPlaylist.view?name=Shared&visibility=private&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;
    sharePlaylistWithUser(db, id, auth.id, true);

    const res = await app.inject({ method: 'GET', url: query(`/rest/deletePlaylist.view?id=${id}`, 'json') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body['subsonic-response'].status).toBe('ok');

    const getRes = await app.inject({ method: 'GET', url: otherQuery(other, `/rest/getPlaylist.view?id=${id}`, 'json') });
    expect(JSON.parse(getRes.body)['subsonic-response'].playlist).toBeUndefined();
  });

  it('allows unauthenticated access to a link playlist with a valid share token', async () => {
    const createRes = await app.inject({
      method: 'GET',
      url: query('/rest/createPlaylist.view?name=Link&visibility=link&songId=song-1', 'json'),
    });
    const id = JSON.parse(createRes.body)['subsonic-response'].playlist?.id;
    const row = db.prepare('SELECT share_token FROM playlists WHERE id = ?').get(id) as { share_token: string } | undefined;
    expect(row).toBeDefined();

    const noToken = await app.inject({ method: 'GET', url: `/rest/getPlaylist.view?id=${id}&f=json` });
    expect(noToken.statusCode).toBe(401);

    const withToken = await app.inject({
      method: 'GET',
      url: `/rest/getPlaylist.view?id=${id}&shareToken=${row!.share_token}&f=json`,
    });
    expect(withToken.statusCode).toBe(200);
    const body = JSON.parse(withToken.body);
    expect(body['subsonic-response'].status).toBe('ok');
    expect(body['subsonic-response'].playlist.name).toBe('Link');
  });
});
