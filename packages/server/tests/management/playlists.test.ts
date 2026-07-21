import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrate.js';
import { hashPassword, hashSubsonicPassword } from '../../src/auth/password.js';
import { createUser } from '../../src/db/repositories/user-repository.js';
import { upsertSong } from '../../src/db/repositories/song-repository.js';
import type { Config } from '../../src/config.js';

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
  SESSION_SECRET: 'a'.repeat(32),
  USE_CRYPTO: false,
  DATA_DIR: '/data',
  LIBRARY_PATH: '/data/library',
  INGEST_PATH: '/data/ingest',
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

async function seedDb(db: Database.Database) {
  createUser(db, {
    id: 'owner-1',
    username: 'owner',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordHash: hashSubsonicPassword('pass'),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  createUser(db, {
    id: 'friend-1',
    username: 'friend',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordHash: hashSubsonicPassword('pass'),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  createUser(db, {
    id: 'stranger-1',
    username: 'stranger',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordHash: hashSubsonicPassword('pass'),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  upsertSong(db, {
    id: 'song-1',
    filePath: '/data/library/song1.mp3',
    title: 'Track One',
    duration: 180,
    mtime: Date.now(),
    checksum: 'c1',
  });
  upsertSong(db, {
    id: 'song-2',
    filePath: '/data/library/song2.mp3',
    title: 'Track Two',
    duration: 200,
    mtime: Date.now(),
    checksum: 'c2',
  });
}

describe('management playlist endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ownerCookie: string;
  let friendCookie: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-playlists-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    config = {
      ...baseConfig,
      DATA_DIR: root,
      LIBRARY_PATH: join(root, 'library'),
      INGEST_PATH: join(root, 'ingest'),
    };
    mkdirSync(config.LIBRARY_PATH, { recursive: true });
    mkdirSync(config.INGEST_PATH, { recursive: true });

    const db = new Database(join(root, 'sonarly.db'));
    migrate(db);
    await seedDb(db);

    app = await buildApp(config, db);

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'owner', password: 'pass' },
    });
    ownerCookie = ownerLogin.cookies.find((c) => c.name === 'sessionId')!.value;

    const friendLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'friend', password: 'pass' },
    });
    friendCookie = friendLogin.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('creates and lists a playlist', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'My Playlist', songIds: ['song-1', 'song-2'] },
    });
    expect(create.statusCode).toBe(201);
    const body = JSON.parse(create.body);
    expect(body.playlist.name).toBe('My Playlist');
    expect(body.playlist.songIds).toEqual(['song-1', 'song-2']);

    const list = await app.inject({
      method: 'GET',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
    });
    expect(list.statusCode).toBe(200);
    const playlists = JSON.parse(list.body).playlists;
    expect(playlists).toHaveLength(1);
    expect(playlists[0].name).toBe('My Playlist');
    expect(playlists[0].songCount).toBe(2);
    expect(playlists[0].ownerUsername).toBe('owner');
  });

  it('updates a playlist and returns the new state', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Old' },
    });
    const id = JSON.parse(create.body).playlist.id;

    const update = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
      payload: { name: 'New', songIds: ['song-2'] },
    });
    expect(update.statusCode).toBe(200);
    const updated = JSON.parse(update.body).playlist;
    expect(updated.name).toBe('New');
    expect(updated.songIds).toEqual(['song-2']);
  });

  it('shares a playlist and allows the shared user to view it', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Shared', visibility: 'private', songIds: ['song-1'] },
    });
    const id = JSON.parse(create.body).playlist.id;

    const share = await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share`,
      cookies: { sessionId: ownerCookie },
      payload: { userId: 'friend-1', canEdit: false },
    });
    expect(share.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: friendCookie },
    });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.body).playlist.name).toBe('Shared');
  });

  it('denies a non-shared user access to a private playlist', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Private', visibility: 'private' },
    });
    const id = JSON.parse(create.body).playlist.id;

    const strangerLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'stranger', password: 'pass' },
    });
    const strangerCookie = strangerLogin.cookies.find((c) => c.name === 'sessionId')!.value;

    const get = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: strangerCookie },
    });
    expect(get.statusCode).toBe(403);
  });

  it('removes a share', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Revoke', visibility: 'private' },
    });
    const id = JSON.parse(create.body).playlist.id;

    await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share`,
      cookies: { sessionId: ownerCookie },
      payload: { userId: 'friend-1', canEdit: false },
    });

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/playlists/${id}/share/friend-1`,
      cookies: { sessionId: ownerCookie },
    });
    expect(remove.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: friendCookie },
    });
    expect(get.statusCode).toBe(403);
  });

  it('only the owner can delete a playlist', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'ToDelete' },
    });
    const id = JSON.parse(create.body).playlist.id;

    const friendDelete = await app.inject({
      method: 'DELETE',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: friendCookie },
    });
    expect(friendDelete.statusCode).toBe(403);

    const ownerDelete = await app.inject({
      method: 'DELETE',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
    });
    expect(ownerDelete.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
    });
    expect(get.statusCode).toBe(404);
  });

  it('allows a shared editor to update', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Editable', songIds: ['song-1'] },
    });
    const id = JSON.parse(create.body).playlist.id;

    await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share`,
      cookies: { sessionId: ownerCookie },
      payload: { userId: 'friend-1', canEdit: true },
    });

    const update = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: friendCookie },
      payload: { name: 'UpdatedByFriend' },
    });
    expect(update.statusCode).toBe(200);
    expect(JSON.parse(update.body).playlist.name).toBe('UpdatedByFriend');
  });

  it('creates a link playlist with a share token', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Link', visibility: 'link', songIds: ['song-1'] },
    });
    expect(create.statusCode).toBe(201);
    const body = JSON.parse(create.body);
    expect(body.playlist.visibility).toBe('link');
    expect(body.playlist.shareToken).toBeDefined();

    const list = await app.inject({
      method: 'GET',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
    });
    const playlists = JSON.parse(list.body).playlists;
    expect(playlists[0].shareToken).toBe(body.playlist.shareToken);
  });

  it('allows unauthenticated access to a link playlist with a valid share token', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Link', visibility: 'link', songIds: ['song-1'] },
    });
    const { id, shareToken } = JSON.parse(create.body).playlist;

    const noToken = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
    });
    expect(noToken.statusCode).toBe(401);

    const withToken = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${shareToken}`,
    });
    expect(withToken.statusCode).toBe(200);
    expect(JSON.parse(withToken.body).playlist.name).toBe('Link');
  });

  it('clears the share token when visibility is changed away from link', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Link', visibility: 'link' },
    });
    const id = JSON.parse(create.body).playlist.id;

    const update = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
      payload: { visibility: 'private' },
    });
    expect(update.statusCode).toBe(200);
    expect(JSON.parse(update.body).playlist.shareToken).toBeUndefined();
  });
});
