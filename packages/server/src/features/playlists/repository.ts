import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Playlist, PlaylistResolveMode, PlaylistVisibility, SmartPlaylistRules } from '@sonarly/shared';
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
  resolve_mode: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeResolveMode(value: string | null | undefined): PlaylistResolveMode {
  return value === 'query' ? 'query' : 'tracks';
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
    resolveMode: normalizeResolveMode(row.resolve_mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fetchStaticSongIds(db: Database.Database, playlistId: string): string[] {
  return db.prepare('SELECT song_id FROM playlist_songs WHERE playlist_id = ? ORDER BY position')
    .pluck().all(playlistId) as string[];
}

// Smart playlists resolve user-scoped rule fields (rating, loved, playcount,
// lastplayed) against the owner's data by default, so shared and public
// viewers all receive the same curated track list. 'query' mode re-resolves
// live against each viewer's own data instead.
function rulesUserId(playlist: Playlist, viewerUserId: string): string {
  return playlist.resolveMode === 'query' ? viewerUserId : playlist.ownerId;
}

export function resolvePlaylistSongIds(db: Database.Database, playlist: Playlist, userId: string): string[] {
  if (playlist.isSmart && playlist.rules) {
    const compiled = compileSmartPlaylist(db, playlist.rules, rulesUserId(playlist, userId));
    return db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
  }
  return playlist.songIds;
}

export function resolvePlaylistSongCount(db: Database.Database, playlist: Playlist, userId: string): number {
  if (playlist.isSmart && playlist.rules) {
    const compiled = compileSmartPlaylist(db, playlist.rules, rulesUserId(playlist, userId));
    const row = db.prepare(compiled.songCountSql).get(...compiled.songCountParams) as { count: number } | undefined;
    return row?.count ?? 0;
  }
  return playlist.songIds.length;
}

// Mirrors resolvePlaylistSongCount's sources so the list view's duration and
// songCount always describe the same membership.
export function resolvePlaylistSongDuration(db: Database.Database, playlist: Playlist, userId: string): number {
  if (playlist.isSmart && playlist.rules) {
    const compiled = compileSmartPlaylist(db, playlist.rules, rulesUserId(playlist, userId));
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    return sumSongDurations(db, ids);
  }
  return sumSongDurations(db, playlist.songIds);
}

function sumSongDurations(db: Database.Database, songIds: string[]): number {
  if (songIds.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < songIds.length; i += 500) {
    const chunk = songIds.slice(i, i + 500);
    const row = db.prepare(`
      SELECT COALESCE(SUM(duration), 0) AS total FROM songs WHERE id IN (${chunk.map(() => '?').join(',')})
    `).get(...chunk) as { total: number } | undefined;
    total += row?.total ?? 0;
  }
  return total;
}

export function createPlaylist(db: Database.Database, playlist: Playlist): void {
  const isSmart = playlist.isSmart === true;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO playlists (id, name, description, owner_id, visibility, share_token, is_smart, rules_json, resolve_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      playlist.id,
      playlist.name,
      playlist.description ?? null,
      playlist.ownerId,
      playlist.visibility,
      playlist.shareToken ?? null,
      isSmart ? 1 : 0,
      isSmart && playlist.rules ? JSON.stringify(playlist.rules) : null,
      normalizeResolveMode(playlist.resolveMode),
    );
    if (!isSmart) {
      insertPlaylistSongs(db, playlist.id, playlist.songIds);
    }
  })();
}

export function updatePlaylist(db: Database.Database, playlist: Playlist): void {
  const isSmart = playlist.isSmart === true;
  db.transaction(() => {
    db.prepare(`
      UPDATE playlists
      SET name = ?, description = ?, visibility = ?, share_token = ?, is_smart = ?, rules_json = ?, resolve_mode = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      playlist.name,
      playlist.description ?? null,
      playlist.visibility,
      playlist.shareToken ?? null,
      isSmart ? 1 : 0,
      isSmart && playlist.rules ? JSON.stringify(playlist.rules) : null,
      normalizeResolveMode(playlist.resolveMode),
      playlist.id,
    );
    // Members only exist for standard playlists; clear stale rows when smart.
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(playlist.id);
    if (!isSmart) {
      insertPlaylistSongs(db, playlist.id, playlist.songIds);
    }
  })();
}

function insertPlaylistSongs(db: Database.Database, playlistId: string, songIds: string[]): void {
  if (songIds.length === 0) return;
  const stmt = db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)');
  for (let i = 0; i < songIds.length; i++) {
    stmt.run(playlistId, songIds[i], i);
  }
}

// Smart playlists don't populate playlist_songs — their membership resolves
// from the stored rules at request time. Resolution results are cached briefly
// (keyed by playlist id + rules, so rule edits invalidate immediately) to avoid
// recompiling per track on cover-art-heavy pages.
const SMART_GRANT_CACHE_TTL_MS = 30_000;

interface SmartGrantCacheEntry {
  ids: Set<string>;
  expiresAt: number;
}

const smartGrantCache = new Map<string, SmartGrantCacheEntry>();

interface SmartLinkPlaylistRow {
  id: string;
  owner_id: string;
  rules_json: string | null;
}

function fetchSmartLinkPlaylists(db: Database.Database, shareToken: string): SmartLinkPlaylistRow[] {
  return db.prepare(`
    SELECT id, owner_id, rules_json
    FROM playlists
    WHERE visibility = 'link' AND share_token = ? AND is_smart = 1
  `).all(shareToken) as SmartLinkPlaylistRow[];
}

function resolveSmartGrantSongIds(db: Database.Database, row: SmartLinkPlaylistRow): Set<string> {
  const key = `${row.id}:${row.rules_json ?? ''}`;
  const now = Date.now();
  const cached = smartGrantCache.get(key);
  if (cached && cached.expiresAt > now) return cached.ids;

  const ids = new Set<string>();
  const rules = parseRules(row.rules_json);
  if (rules) {
    // Same compiler path as resolvePlaylistSongIds; user-scoped rule fields
    // resolve against the playlist owner, matching the anonymous detail view.
    const compiled = compileSmartPlaylist(db, rules, row.owner_id);
    for (const id of db.prepare(compiled.sql).pluck().all(...compiled.params) as string[]) {
      ids.add(id);
    }
  }
  smartGrantCache.set(key, { ids, expiresAt: now + SMART_GRANT_CACHE_TTL_MS });
  return ids;
}

function shareTokenGrantsSmartSongIds(db: Database.Database, shareToken: string): Set<string> | undefined {
  const smartPlaylists = fetchSmartLinkPlaylists(db, shareToken);
  if (smartPlaylists.length === 0) return undefined;
  const ids = new Set<string>();
  for (const row of smartPlaylists) {
    for (const id of resolveSmartGrantSongIds(db, row)) {
      ids.add(id);
    }
  }
  return ids;
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
  if (row !== undefined) return true;
  return shareTokenGrantsSmartSongIds(db, shareToken)?.has(songId) ?? false;
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
  if (row !== undefined) return true;

  const smartSongIds = shareTokenGrantsSmartSongIds(db, shareToken);
  if (!smartSongIds || smartSongIds.size === 0) return false;
  const ids = [...smartSongIds];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const match = db.prepare(`
      SELECT 1
      FROM songs s
      LEFT JOIN albums a ON a.id = s.album_id
      WHERE s.active = 1 AND s.id IN (${chunk.map(() => '?').join(',')})
        AND (s.cover_art_id = ? OR a.cover_art_id = ?)
      LIMIT 1
    `).get(...chunk, coverArtId, coverArtId);
    if (match !== undefined) return true;
  }
  return false;
}

export function sharePlaylistWithUser(db: Database.Database, playlistId: string, userId: string, canEdit: boolean): void {
  db.prepare(`
    INSERT INTO playlist_shares (playlist_id, user_id, can_edit) VALUES (?, ?, ?)
    ON CONFLICT(playlist_id, user_id) DO UPDATE SET can_edit = excluded.can_edit
  `).run(playlistId, userId, canEdit ? 1 : 0);
}
