import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { createUser } from '../../src/db/repositories/user-repository.js';
import { createPlaylist, sharePlaylistWithUser } from '../../src/db/repositories/playlist-repository.js';
import type { User, Playlist } from '@sonarly/shared';

describe('playlist repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('updates permission when sharing the same playlist with the same user twice', () => {
    const owner: User & { passwordHash: string; subsonicPasswordHash: string } = {
      id: 'owner-1',
      username: 'owner',
      isAdmin: false,
      createdAt: new Date().toISOString(),
      passwordHash: 'hash',
      subsonicPasswordHash: 'hash',
    };
    createUser(db, owner);

    const user: User & { passwordHash: string; subsonicPasswordHash: string } = {
      id: 'user-1',
      username: 'friend',
      isAdmin: false,
      createdAt: new Date().toISOString(),
      passwordHash: 'hash',
      subsonicPasswordHash: 'hash',
    };
    createUser(db, user);

    const playlist: Playlist = {
      id: 'playlist-1',
      name: 'My Playlist',
      ownerId: owner.id,
      visibility: 'private',
      songIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    createPlaylist(db, playlist);

    sharePlaylistWithUser(db, playlist.id, user.id, false);
    sharePlaylistWithUser(db, playlist.id, user.id, true);

    const share = db.prepare('SELECT can_edit FROM playlist_shares WHERE playlist_id = ? AND user_id = ?')
      .get(playlist.id, user.id) as { can_edit: number };
    expect(share.can_edit).toBe(1);
  });
});
