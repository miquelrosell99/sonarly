import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Playlist, PlaylistVisibility } from '@sonarly/shared';
import { sendSubsonicReply } from '../responses.js';
import { getPlaylistById, createPlaylist, updatePlaylist, generateShareToken } from '../../db/repositories/playlist-repository.js';

interface SongRow {
  id: string;
  title: string;
  track_number: number | null;
  disc_number: number | null;
  duration: number | null;
  genre: string | null;
  year: number | null;
  mtime: number;
  album_name: string | null;
  artist_name: string | null;
}

export function registerPlaylistRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/getPlaylists.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const rows = db.prepare(`
      SELECT DISTINCT p.id FROM playlists p
      LEFT JOIN playlist_shares ps ON ps.playlist_id = p.id
      WHERE p.owner_id = ? OR p.visibility IN ('public', 'link') OR ps.user_id = ?
      ORDER BY p.name
    `).pluck().all(userId, userId) as string[];
    const playlists = rows.map((id) => getPlaylistById(db, id)).filter((p): p is Playlist => p !== undefined);
    sendSubsonicReply(reply, format, {
      playlists: { playlist: playlists.map((p) => toOpenSubsonicPlaylist(p, false)) },
    });
  });

  app.get('/rest/getPlaylist.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser as string | undefined;
    const { id, shareToken } = request.query as { id: string; shareToken?: string };
    const playlist = getPlaylistById(db, id);
    if (!playlist) {
      return sendSubsonicReply(reply, format, {});
    }
    if (!canViewPlaylist(db, playlist, userId, shareToken)) {
      return sendUnauthorized(reply, format);
    }
    sendSubsonicReply(reply, format, { playlist: toOpenSubsonicPlaylist(playlist, true, db) });
  });

  app.get('/rest/createPlaylist.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const query = request.query as Record<string, string | string[]>;
    const ownerId = (request as any).subsonicUser;
    const songIds = normalizeParam(query.songId);
    const visibility = asVisibility(query.visibility) ?? 'private';
    const now = new Date().toISOString();
    const playlist: Playlist = {
      id: randomUUID(),
      name: asName(query.name) ?? 'New Playlist',
      ownerId,
      visibility,
      shareToken: visibility === 'link' ? generateShareToken() : undefined,
      songIds,
      createdAt: now,
      updatedAt: now,
    };
    createPlaylist(db, playlist);
    sendSubsonicReply(reply, format, { playlist: toOpenSubsonicPlaylist(playlist, true) });
  });

  app.get('/rest/updatePlaylist.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const query = request.query as Record<string, string | string[]>;
    const playlistId = String(query.playlistId ?? '');
    const existing = getPlaylistById(db, playlistId);
    if (!existing) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }

    if (!canEditOrOwnPlaylist(db, existing, userId)) {
      return sendUnauthorized(reply, format);
    }

    let songIds = existing.songIds.slice();

    const replaceIds = normalizeParam(query.songId);
    if (replaceIds.length > 0) {
      songIds = replaceIds;
    }

    const addIds = normalizeParam(query.songIdToAdd);
    if (addIds.length > 0) {
      songIds = songIds.concat(addIds);
    }

    const removeIndexes = normalizeParam(query.songIndexToRemove).map((i) => parseInt(i, 10));
    if (removeIndexes.length > 0) {
      const sorted = removeIndexes.filter((i) => !Number.isNaN(i)).sort((a, b) => b - a);
      for (const idx of sorted) {
        if (idx >= 0 && idx < songIds.length) {
          songIds.splice(idx, 1);
        }
      }
    }

    const visibility = asVisibility(query.visibility) ?? existing.visibility;
    let shareToken = existing.shareToken;
    if (visibility === 'link' && !shareToken) {
      shareToken = generateShareToken();
    } else if (visibility !== 'link') {
      shareToken = undefined;
    }

    const updated: Playlist = {
      ...existing,
      name: asName(query.name) ?? existing.name,
      visibility,
      shareToken,
      songIds,
      updatedAt: new Date().toISOString(),
    };
    updatePlaylist(db, updated);
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/deletePlaylist.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id } = request.query as { id: string };
    const existing = getPlaylistById(db, id);
    if (!existing) {
      return sendSubsonicReply(reply, format, {});
    }
    if (!canEditOrOwnPlaylist(db, existing, userId)) {
      return sendUnauthorized(reply, format);
    }
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    sendSubsonicReply(reply, format, {});
  });
}

function normalizeParam(value: string | string[] | undefined): string[] {
  if (value === undefined || value === '') return [];
  return Array.isArray(value) ? value.filter((v) => v !== '') : [value];
}

function asName(value: string | string[] | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  const v = Array.isArray(value) ? value[0] : value;
  return v === '' ? undefined : v;
}

function asVisibility(value: string | string[] | undefined): PlaylistVisibility | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === 'private' || v === 'shared' || v === 'public' || v === 'link') return v;
  return undefined;
}

function canViewPlaylist(
  db: Database.Database,
  playlist: Playlist,
  userId: string | undefined,
  shareToken?: string,
): boolean {
  if (userId && playlist.ownerId === userId) return true;
  if (playlist.visibility === 'public') return true;
  if (playlist.visibility === 'link' && shareToken && shareToken === playlist.shareToken) return true;
  if (!userId) return false;
  const share = db.prepare('SELECT 1 FROM playlist_shares WHERE playlist_id = ? AND user_id = ?')
    .get(playlist.id, userId) as { 1: number } | undefined;
  return share !== undefined;
}

function canEditOrOwnPlaylist(db: Database.Database, playlist: Playlist, userId: string): boolean {
  if (playlist.ownerId === userId) return true;
  const share = db.prepare('SELECT can_edit FROM playlist_shares WHERE playlist_id = ? AND user_id = ?')
    .get(playlist.id, userId) as { can_edit: number } | undefined;
  return share !== undefined && share.can_edit === 1;
}

function sendUnauthorized(reply: FastifyReply, format: 'json' | 'xml'): FastifyReply {
  return sendSubsonicReply(reply, format, {
    error: { code: 50, message: 'User is not authorized for this operation' },
  }, 'failed');
}

function toOpenSubsonicPlaylist(
  p: Playlist,
  includeEntries: false,
  db?: never,
): Record<string, unknown>;
function toOpenSubsonicPlaylist(
  p: Playlist,
  includeEntries: true,
  db?: Database.Database,
): Record<string, unknown>;
function toOpenSubsonicPlaylist(
  p: Playlist,
  includeEntries: boolean,
  db?: Database.Database,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    owner: p.ownerId,
    public: p.visibility === 'public' || p.visibility === 'link',
    songCount: p.songIds.length,
    created: p.createdAt,
    changed: p.updatedAt,
  };

  if (includeEntries && db) {
    base.entry = fetchPlaylistSongs(db, p.songIds);
  } else if (includeEntries) {
    base.entry = [];
  }

  return base;
}

function fetchPlaylistSongs(db: Database.Database, songIds: string[]): Record<string, unknown>[] {
  if (songIds.length === 0) return [];
  const rows = db.prepare(`
    SELECT s.*, a.name AS album_name, ar.name AS artist_name
    FROM songs s
    LEFT JOIN albums a ON a.id = s.album_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    WHERE s.id IN (${songIds.map(() => '?').join(',')})
  `).all(...songIds) as SongRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return songIds
    .map((id) => byId.get(id))
    .filter((row): row is SongRow => row !== undefined)
    .map((song) => ({
      id: song.id,
      title: song.title,
      album: song.album_name ?? '',
      artist: song.artist_name ?? '',
      track: song.track_number,
      discNumber: song.disc_number,
      genre: song.genre,
      year: song.year,
      duration: song.duration,
      type: 'music',
      isDir: false,
      created: new Date(song.mtime).toISOString(),
    }));
}
