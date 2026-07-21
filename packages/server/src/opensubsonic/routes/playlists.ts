import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Playlist, PlaylistVisibility } from '@sonarly/shared';
import { sendSubsonicReply } from '../responses.js';
import { getPlaylistById, createPlaylist, updatePlaylist } from '../../db/repositories/playlist-repository.js';

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
    const { id } = request.query as { id: string };
    const playlist = getPlaylistById(db, id);
    if (!playlist) {
      return sendSubsonicReply(reply, format, {});
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
      name: String(query.name || 'New Playlist'),
      ownerId,
      visibility,
      songIds,
      createdAt: now,
      updatedAt: now,
    };
    createPlaylist(db, playlist);
    sendSubsonicReply(reply, format, { playlist: toOpenSubsonicPlaylist(playlist, true) });
  });

  app.get('/rest/updatePlaylist.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const query = request.query as Record<string, string | string[]>;
    const playlistId = String(query.playlistId ?? '');
    const existing = getPlaylistById(db, playlistId);
    if (!existing) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
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

    const updated: Playlist = {
      ...existing,
      name: query.name ? String(query.name) : existing.name,
      visibility: asVisibility(query.visibility) ?? existing.visibility,
      songIds,
      updatedAt: new Date().toISOString(),
    };
    updatePlaylist(db, updated);
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/deletePlaylist.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const { id } = request.query as { id: string };
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    sendSubsonicReply(reply, format, {});
  });
}

function normalizeParam(value: string | string[] | undefined): string[] {
  if (value === undefined || value === '') return [];
  return Array.isArray(value) ? value.filter((v) => v !== '') : [value];
}

function asVisibility(value: string | string[] | undefined): PlaylistVisibility | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === 'private' || v === 'shared' || v === 'public' || v === 'link') return v;
  return undefined;
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
