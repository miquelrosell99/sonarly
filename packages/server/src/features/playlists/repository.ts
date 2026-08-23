import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Playlist, PlaylistVisibility, SmartPlaylistRules } from '@sonarly/shared';
import { compileSmartPlaylist } from '../smart-playlists/compiler.js';

export function generateShareToken(): string {
  return randomUUID();
}

interface DbPlaylist {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  visibility: PlaylistVisibility;
  share_token: string | null;
  is_smart: number;
  rules_json: string | null;
  created_at: string;
  updated_at: string;
}

function parseRules(json: string | null): SmartPlaylistRules | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as SmartPlaylistRules;
  } catch {
    return undefined;
  }
}

export function getPlaylistById(db: Database.Database, id: string): Playlist | undefined {
  const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as DbPlaylist | undefined;
  if (!row) return undefined;
  const isSmart = row.is_smart === 1;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    ownerId: row.owner_id,
    visibility: row.visibility,
    shareToken: row.share_token ?? undefined,
    songIds: isSmart ? [] : fetchStaticSongIds(db, id),
    isSmart,
    rules: isSmart ? parseRules(row.rules_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fetchStaticSongIds(db: Database.Database, playlistId: string): string[] {
  return db.prepare('SELECT song_id FROM playlist_songs WHERE playlist_id = ? ORDER BY position')
    .pluck().all(playlistId) as string[];
}

export function resolvePlaylistSongIds(db: Database.Database, playlist: Playlist, userId: string): string[] {
  if (playlist.isSmart && playlist.rules) {
    const compiled = compileSmartPlaylist(db, playlist.rules, userId);
    return db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
  }
  return playlist.songIds;
}

export function resolvePlaylistSongCount(db: Database.Database, playlist: Playlist, userId: string): number {
  if (playlist.isSmart && playlist.rules) {
    const compiled = compileSmartPlaylist(db, playlist.rules, userId);
    const row = db.prepare(compiled.songCountSql).get(...compiled.songCountParams) as { count: number } | undefined;
    return row?.count ?? 0;
  }
  return playlist.songIds.length;
}

export function createPlaylist(db: Database.Database, playlist: Playlist): void {
  const isSmart = playlist.isSmart === true;
  db.prepare(`
    INSERT INTO playlists (id, name, description, owner_id, visibility, share_token, is_smart, rules_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    playlist.id,
    playlist.name,
    playlist.description ?? null,
    playlist.ownerId,
    playlist.visibility,
    playlist.shareToken ?? null,
    isSmart ? 1 : 0,
    isSmart && playlist.rules ? JSON.stringify(playlist.rules) : null,
  );
  if (!isSmart) {
    insertPlaylistSongs(db, playlist.id, playlist.songIds);
  }
}

export function updatePlaylist(db: Database.Database, playlist: Playlist): void {
  const isSmart = playlist.isSmart === true;
  db.prepare(`
    UPDATE playlists
    SET name = ?, description = ?, visibility = ?, share_token = ?, is_smart = ?, rules_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    playlist.name,
    playlist.description ?? null,
    playlist.visibility,
    playlist.shareToken ?? null,
    isSmart ? 1 : 0,
    isSmart && playlist.rules ? JSON.stringify(playlist.rules) : null,
    playlist.id,
  );
  // Members only exist for standard playlists; clear stale rows when smart.
  db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(playlist.id);
  if (!isSmart) {
    insertPlaylistSongs(db, playlist.id, playlist.songIds);
  }
}

function insertPlaylistSongs(db: Database.Database, playlistId: string, songIds: string[]): void {
  if (songIds.length === 0) return;
  const stmt = db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)');
  for (let i = 0; i < songIds.length; i++) {
    stmt.run(playlistId, songIds[i], i);
  }
}

// A share token only ever authorizes content belonging to the link-shared
// playlist it was minted for; both checks scope the EXISTS to that playlist.
export function shareTokenGrantsSong(db: Database.Database, shareToken: string, songId: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM playlists p
    JOIN playlist_songs ps ON ps.playlist_id = p.id
    JOIN songs s ON s.id = ps.song_id AND s.active = 1
    WHERE p.visibility = 'link' AND p.share_token = ? AND ps.song_id = ?
    LIMIT 1
  `).get(shareToken, songId);
  return row !== undefined;
}

export function shareTokenGrantsCoverArt(db: Database.Database, shareToken: string, coverArtId: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM playlists p
    JOIN playlist_songs ps ON ps.playlist_id = p.id
    JOIN songs s ON s.id = ps.song_id AND s.active = 1
    LEFT JOIN albums a ON a.id = s.album_id
    WHERE p.visibility = 'link' AND p.share_token = ?
      AND (s.cover_art_id = ? OR a.cover_art_id = ?)
    LIMIT 1
  `).get(shareToken, coverArtId, coverArtId);
  return row !== undefined;
}

export function sharePlaylistWithUser(db: Database.Database, playlistId: string, userId: string, canEdit: boolean): void {
  db.prepare(`
    INSERT INTO playlist_shares (playlist_id, user_id, can_edit) VALUES (?, ?, ?)
    ON CONFLICT(playlist_id, user_id) DO UPDATE SET can_edit = excluded.can_edit
  `).run(playlistId, userId, canEdit ? 1 : 0);
}
