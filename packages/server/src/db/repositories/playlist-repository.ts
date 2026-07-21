import Database from 'better-sqlite3';
import type { Playlist, PlaylistVisibility } from '@sonarly/shared';

export function getPlaylistById(db: Database.Database, id: string): Playlist | undefined {
  const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as any;
  if (!row) return undefined;
  const songs = db.prepare('SELECT song_id FROM playlist_songs WHERE playlist_id = ? ORDER BY position')
    .pluck().all(id) as string[];
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    visibility: row.visibility as PlaylistVisibility,
    shareToken: row.share_token ?? undefined,
    songIds: songs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPlaylist(db: Database.Database, playlist: Playlist): void {
  db.prepare('INSERT INTO playlists (id, name, owner_id, visibility, share_token) VALUES (?, ?, ?, ?, ?)')
    .run(playlist.id, playlist.name, playlist.ownerId, playlist.visibility, playlist.shareToken ?? null);
  insertPlaylistSongs(db, playlist.id, playlist.songIds);
}

export function updatePlaylist(db: Database.Database, playlist: Playlist): void {
  db.prepare('UPDATE playlists SET name = ?, visibility = ?, share_token = ?, updated_at = datetime("now") WHERE id = ?')
    .run(playlist.name, playlist.visibility, playlist.shareToken ?? null, playlist.id);
  db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(playlist.id);
  insertPlaylistSongs(db, playlist.id, playlist.songIds);
}

function insertPlaylistSongs(db: Database.Database, playlistId: string, songIds: string[]): void {
  const stmt = db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)');
  for (let i = 0; i < songIds.length; i++) {
    stmt.run(playlistId, songIds[i], i);
  }
}

export function sharePlaylistWithUser(db: Database.Database, playlistId: string, userId: string, canEdit: boolean): void {
  db.prepare(`
    INSERT INTO playlist_shares (playlist_id, user_id, can_edit) VALUES (?, ?, ?)
    ON CONFLICT(playlist_id, user_id) DO UPDATE SET can_edit = excluded.can_edit
  `).run(playlistId, userId, canEdit ? 1 : 0);
}
