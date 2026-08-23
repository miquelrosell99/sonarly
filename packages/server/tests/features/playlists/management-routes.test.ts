import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
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
    subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  createUser(db, {
    id: 'friend-1',
    username: 'friend',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  createUser(db, {
    id: 'stranger-1',
    username: 'stranger',
    passwordHash: await hashPassword('pass'),
    subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
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
  let db: Database.Database;

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

    db = new Database(join(root, 'sonarly.db'));
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

  it('does not leak owner interactions to anonymous share-token viewers', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Link', visibility: 'link', songIds: ['song-1'] },
    });
    const { id, shareToken } = JSON.parse(create.body).playlist;

    db.prepare('INSERT INTO user_playlists (user_id, playlist_id, starred, rating) VALUES (?, ?, ?, ?)')
      .run('owner-1', id, 1, 5);

    const withToken = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${shareToken}`,
    });
    expect(withToken.statusCode).toBe(200);
    const body = JSON.parse(withToken.body).playlist;
    expect(body.starred).toBe(false);
    expect(body.rating).toBeUndefined();
  });

  it('keeps the share token when visibility changes; revoking is explicit', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Link', visibility: 'link' },
    });
    const { id, shareToken } = JSON.parse(create.body).playlist;

    const update = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
      payload: { visibility: 'private' },
    });
    expect(update.statusCode).toBe(200);
    expect(JSON.parse(update.body).playlist.shareToken).toBe(shareToken);

    // The token still authorizes anonymous viewers even though the playlist
    // is now private.
    const withToken = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${shareToken}`,
    });
    expect(withToken.statusCode).toBe(200);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/playlists/${id}/share-link`,
      cookies: { sessionId: ownerCookie },
    });
    expect(revoke.statusCode).toBe(200);

    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${shareToken}`,
    });
    expect(afterRevoke.statusCode).toBe(403);
  });

  it('generates and regenerates share links, owner only', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Private', visibility: 'private', songIds: ['song-1'] },
    });
    const id = JSON.parse(create.body).playlist.id;

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share-link`,
      cookies: { sessionId: friendCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const first = await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share-link`,
      cookies: { sessionId: ownerCookie },
    });
    expect(first.statusCode).toBe(200);
    const firstToken = JSON.parse(first.body).shareToken;
    expect(firstToken).toBeDefined();

    // Token works even though visibility stays private.
    const anon = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${firstToken}`,
    });
    expect(anon.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share-link`,
      cookies: { sessionId: ownerCookie },
    });
    const secondToken = JSON.parse(second.body).shareToken;
    expect(secondToken).not.toBe(firstToken);

    const oldToken = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${firstToken}`,
    });
    expect(oldToken.statusCode).toBe(403);

    const newToken = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${secondToken}`,
    });
    expect(newToken.statusCode).toBe(200);
  });

  it('supports a public playlist with a token link and member edit access at once', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Public', visibility: 'public', songIds: ['song-1'] },
    });
    const id = JSON.parse(create.body).playlist.id;

    await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share`,
      cookies: { sessionId: ownerCookie },
      payload: { userId: 'friend-1', canEdit: true },
    });
    const link = await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share-link`,
      cookies: { sessionId: ownerCookie },
    });
    const { shareToken } = JSON.parse(link.body);

    // Anonymous token viewer.
    const anon = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${shareToken}`,
    });
    expect(anon.statusCode).toBe(200);

    // Any authenticated user can view because it is public.
    const strangerLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'stranger', password: 'pass' },
    });
    const strangerCookie = strangerLogin.cookies.find((c) => c.name === 'sessionId')!.value;
    const strangerGet = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: strangerCookie },
    });
    expect(strangerGet.statusCode).toBe(200);

    // The member with can_edit can still edit.
    const friendUpdate = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: friendCookie },
      payload: { name: 'EditedByFriend' },
    });
    expect(friendUpdate.statusCode).toBe(200);

    // But a stranger cannot edit.
    const strangerUpdate = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: strangerCookie },
      payload: { name: 'Nope' },
    });
    expect(strangerUpdate.statusCode).toBe(403);
  });

  it('includes the shares list for the owner only', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Shared', visibility: 'shared', songIds: ['song-1'] },
    });
    const id = JSON.parse(create.body).playlist.id;

    await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share`,
      cookies: { sessionId: ownerCookie },
      payload: { userId: 'friend-1', canEdit: true },
    });

    const ownerGet = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: ownerCookie },
    });
    expect(ownerGet.statusCode).toBe(200);
    expect(JSON.parse(ownerGet.body).playlist.shares).toEqual([
      { userId: 'friend-1', username: 'friend', canEdit: true },
    ]);

    const friendGet = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}`,
      cookies: { sessionId: friendCookie },
    });
    expect(friendGet.statusCode).toBe(200);
    expect(JSON.parse(friendGet.body).playlist.shares).toBeUndefined();
  });

  it('omits the shares list for anonymous share-token viewers', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Link', visibility: 'link', songIds: ['song-1'] },
    });
    const { id, shareToken } = JSON.parse(create.body).playlist;

    await app.inject({
      method: 'POST',
      url: `/api/playlists/${id}/share`,
      cookies: { sessionId: ownerCookie },
      payload: { userId: 'friend-1', canEdit: false },
    });

    const withToken = await app.inject({
      method: 'GET',
      url: `/api/playlists/${id}?shareToken=${shareToken}`,
    });
    expect(withToken.statusCode).toBe(200);
    expect(JSON.parse(withToken.body).playlist.shares).toBeUndefined();
  });

  it('converts a smart playlist to a normal playlist', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: {
        name: 'Smart',
        isSmart: true,
        rules: { rules: { all: [{ field: 'title', operator: 'contains', value: 'Track' }] } },
      },
    });
    const { playlist } = JSON.parse(createRes.body) as { playlist: { id: string } };

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${playlist.id}`,
      cookies: { sessionId: ownerCookie },
      payload: { isSmart: false },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/playlists/${playlist.id}`,
      cookies: { sessionId: ownerCookie },
    });
    const body = JSON.parse(getRes.body) as { playlist: { isSmart: boolean; songCount: number } };
    expect(body.playlist.isSmart).toBe(false);
    expect(body.playlist.songCount).toBeGreaterThanOrEqual(1);
  });

  it('converts a standard playlist to smart, removing its members', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: { name: 'Standard', songIds: ['song-1', 'song-2'] },
    });
    const { playlist } = JSON.parse(createRes.body) as { playlist: { id: string } };

    const noRules = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${playlist.id}`,
      cookies: { sessionId: ownerCookie },
      payload: { isSmart: true },
    });
    expect(noRules.statusCode).toBe(400);

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/playlists/${playlist.id}`,
      cookies: { sessionId: ownerCookie },
      payload: {
        isSmart: true,
        rules: { rules: { all: [{ field: 'title', operator: 'contains', value: 'Track' }] } },
      },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/playlists/${playlist.id}`,
      cookies: { sessionId: ownerCookie },
    });
    const body = JSON.parse(getRes.body) as { playlist: { isSmart: boolean; songIds?: string[] } };
    expect(body.playlist.isSmart).toBe(true);
    expect(body.playlist.songIds ?? []).toEqual([]);
  });

  it('resolves smart playlist songs for anonymous share-token viewers', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: { sessionId: ownerCookie },
      payload: {
        name: 'Smart Link',
        visibility: 'link',
        isSmart: true,
        rules: { rules: { all: [{ field: 'title', operator: 'contains', value: 'Track One' }] } },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { playlist } = JSON.parse(createRes.body) as { playlist: { id: string; shareToken: string } };
    expect(playlist.shareToken).toBeDefined();

    const res = await app.inject({
      method: 'GET',
      url: `/api/playlists/${playlist.id}?shareToken=${playlist.shareToken}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      playlist: { isSmart: boolean; songCount: number; entries: { id: string; title: string }[] };
    };
    expect(body.playlist.isSmart).toBe(true);
    expect(body.playlist.songCount).toBe(1);
    expect(body.playlist.entries.map((e) => e.id)).toEqual(['song-1']);
  });
});
