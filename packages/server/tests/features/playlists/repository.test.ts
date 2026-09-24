import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import {
  createPlaylist,
  getPlaylistById,
  sharePlaylistWithUser,
  updatePlaylist,
  resolvePlaylistSongIds,
  resolvePlaylistSongCount,
} from '../../../src/features/playlists/repository.js';
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
    const owner: User & { passwordHash: string; subsonicPasswordEncrypted: string } = {
      id: 'owner-1',
      username: 'owner',
      isAdmin: false,
      createdAt: new Date().toISOString(),
      passwordHash: 'hash',
      subsonicPasswordEncrypted: 'encrypted',
    };
    createUser(db, owner);

    const user: User & { passwordHash: string; subsonicPasswordEncrypted: string } = {
      id: 'user-1',
      username: 'friend',
      isAdmin: false,
      createdAt: new Date().toISOString(),
      passwordHash: 'hash',
      subsonicPasswordEncrypted: 'encrypted',
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

  describe('smart playlist resolution mode', () => {
    const owner: User & { passwordHash: string; subsonicPasswordEncrypted: string } = {
      id: 'owner-1',
      username: 'owner',
      isAdmin: false,
      createdAt: new Date().toISOString(),
      passwordHash: 'hash',
      subsonicPasswordEncrypted: 'encrypted',
    };
    const viewer: User & { passwordHash: string; subsonicPasswordEncrypted: string } = {
      id: 'viewer-1',
      username: 'viewer',
      isAdmin: false,
      createdAt: new Date().toISOString(),
      passwordHash: 'hash',
      subsonicPasswordEncrypted: 'encrypted',
    };

    const insertSong = (id: string) => {
      db.prepare(`
        INSERT INTO songs (id, file_path, title, mtime, checksum, active)
        VALUES (?, ?, ?, 1, ?, 1)
      `).run(id, `/${id}.mp3`, `Song ${id}`, `c-${id}`);
    };

    const rate = (userId: string, songId: string, rating: number) => {
      db.prepare(`
        INSERT INTO user_songs (user_id, song_id, starred, rating, play_count, last_played)
        VALUES (?, ?, 0, ?, 0, NULL)
      `).run(userId, songId, rating);
    };

    const smartPlaylist = (resolveMode?: Playlist['resolveMode']): Playlist => ({
      id: 'smart-1',
      name: 'Smart',
      ownerId: owner.id,
      visibility: 'public',
      songIds: [],
      isSmart: true,
      rules: { rules: { all: [{ field: 'rating', operator: 'gte', value: 4 }] } },
      resolveMode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    beforeEach(() => {
      createUser(db, owner);
      createUser(db, viewer);
      insertSong('s1');
      insertSong('s2');
      insertSong('s3');
      // Owner: only s1 is rated 4+. Viewer: only s2 is rated 4+.
      rate(owner.id, 's1', 5);
      rate(owner.id, 's2', 3);
      rate(viewer.id, 's2', 5);
    });

    it('resolves user-scoped rules against the owner by default (tracks mode)', () => {
      createPlaylist(db, smartPlaylist());
      const playlist = getPlaylistById(db, 'smart-1')!;
      expect(playlist.resolveMode).toBe('tracks');
      expect(resolvePlaylistSongIds(db, playlist, viewer.id)).toEqual(['s1']);
      expect(resolvePlaylistSongCount(db, playlist, viewer.id)).toBe(1);
      // The owner sees the same list.
      expect(resolvePlaylistSongIds(db, playlist, owner.id)).toEqual(['s1']);
    });

    it('resolves user-scoped rules against each viewer in query mode', () => {
      createPlaylist(db, smartPlaylist('query'));
      const playlist = getPlaylistById(db, 'smart-1')!;
      expect(playlist.resolveMode).toBe('query');
      expect(resolvePlaylistSongIds(db, playlist, viewer.id)).toEqual(['s2']);
      expect(resolvePlaylistSongIds(db, playlist, owner.id)).toEqual(['s1']);
    });

    it('persists mode changes through updatePlaylist', () => {
      createPlaylist(db, smartPlaylist());
      const existing = getPlaylistById(db, 'smart-1')!;
      updatePlaylist(db, { ...existing, resolveMode: 'query' });
      expect(getPlaylistById(db, 'smart-1')!.resolveMode).toBe('query');
    });
  });
});
