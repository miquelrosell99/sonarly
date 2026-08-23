import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Playlist, PlaylistVisibility, SmartPlaylistRules } from '@sonarly/shared';
import { isSmartPlaylistRuleGroup } from '@sonarly/shared';
import {
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  sharePlaylistWithUser,
  generateShareToken,
  resolvePlaylistSongIds,
  resolvePlaylistSongCount,
} from '../playlists/index.js';
import { getUserById } from '../users/index.js';
import { DbAlbum, toAlbum } from '../albums/repository.js';
import { attachSongArtistEntries } from '../songs/repository.js';

const VISIBILITIES: PlaylistVisibility[] = ['private', 'shared', 'public', 'link'];

function isVisibility(value: unknown): value is PlaylistVisibility {
  return typeof value === 'string' && VISIBILITIES.includes(value as PlaylistVisibility);
}

function canViewPlaylist(
  db: Database.Database,
  playlist: Playlist,
  userId: string | undefined,
  shareToken?: string,
): boolean {
  if (userId && playlist.ownerId === userId) return true;
  if (playlist.visibility === 'public') return true;
  // A set share token always authorizes anonymous token viewers, independent
  // of the visibility value — a playlist can be public AND have a link, or
  // have a link without being public.
  if (playlist.shareToken && shareToken && shareToken === playlist.shareToken) return true;
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

interface PlaylistListRow {
  id: string;
  name: string;
  owner_id: string;
  owner_username: string;
  visibility: PlaylistVisibility;
  share_token: string | null;
  is_smart: number;
  created_at: string;
  updated_at: string;
  song_count: number;
  starred: number | null;
  rating: number | null;
}

interface PlaylistSongRow {
  id: string;
  title: string;
  track_number: number | null;
  disc_number: number | null;
  duration: number | null;
  genre: string | null;
  year: number | null;
  explicit: number;
  mtime: number;
  cover_art_id: string | null;
  album_id: string | null;
  album_name: string | null;
  album_cover_art_id: string | null;
  artist_id: string | null;
  artist_name: string | null;
}

// Chunk IN (...) queries: one placeholder per song id would exceed SQLite's
// variable limit (999 by default) on huge playlists.
const SQLITE_VARIABLE_CHUNK = 500;

function fetchPlaylistSongs(db: Database.Database, songIds: string[]): Record<string, unknown>[] {
  if (songIds.length === 0) return [];
  const rows: PlaylistSongRow[] = [];
  for (let i = 0; i < songIds.length; i += SQLITE_VARIABLE_CHUNK) {
    const chunk = songIds.slice(i, i + SQLITE_VARIABLE_CHUNK);
    rows.push(...db.prepare(`
      SELECT s.*, a.id AS album_id, a.name AS album_name, a.cover_art_id AS album_cover_art_id, ar.id AS artist_id, ar.name AS artist_name
      FROM songs s
      LEFT JOIN albums a ON a.id = s.album_id
      LEFT JOIN artists ar ON ar.id = s.artist_id
      WHERE s.active = 1 AND s.id IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk) as PlaylistSongRow[]);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const entries = songIds
    .map((id) => byId.get(id))
    .filter((row): row is PlaylistSongRow => row !== undefined)
    .map((song) => ({
      id: song.id,
      title: song.title,
      album: song.album_name ?? '',
      albumId: song.album_id ?? undefined,
      artist: song.artist_name ?? '',
      artistId: song.artist_id ?? undefined,
      track: song.track_number,
      discNumber: song.disc_number,
      genre: song.genre,
      year: song.year,
      explicit: song.explicit === 1,
      duration: song.duration,
      coverArt: song.cover_art_id ?? undefined,
      albumCoverArt: song.album_cover_art_id ?? undefined,
      type: 'music',
      isDir: false,
      created: new Date(song.mtime).toISOString(),
    }));
  attachSongArtistEntries(db, entries as any);
  return entries;
}

function serializeRules(rules: unknown): SmartPlaylistRules | undefined {
  if (!rules || typeof rules !== 'object') return undefined;
  const r = rules as SmartPlaylistRules;
  if (r.rules && !isSmartPlaylistRuleGroup(r.rules)) {
    throw new Error('Invalid rules group');
  }
  return r;
}

export function registerPlaylistManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/playlists', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const rows = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.owner_id,
        u.username AS owner_username,
        p.visibility,
        p.share_token,
        p.is_smart,
        p.created_at,
        p.updated_at,
        (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count,
        up.starred,
        up.rating
      FROM playlists p
      JOIN users u ON u.id = p.owner_id
      LEFT JOIN user_playlists up ON up.user_id = ? AND up.playlist_id = p.id
      WHERE p.owner_id = ?
         OR p.visibility = 'public'
         OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id AND ps.user_id = ?)
      ORDER BY p.updated_at DESC
    `).all(userId, userId, userId) as PlaylistListRow[];

    const playlists = rows.map((r) => {
      const isSmart = r.is_smart === 1;
      const base = getPlaylistById(db, r.id)!;
      return {
        id: r.id,
        name: r.name,
        description: base.description,
        ownerId: r.owner_id,
        ownerUsername: r.owner_username,
        visibility: r.visibility,
        shareToken: r.owner_id === userId ? (r.share_token ?? undefined) : undefined,
        isSmart,
        songCount: isSmart ? resolvePlaylistSongCount(db, base, userId) : r.song_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        starred: r.starred === 1,
        rating: r.rating ?? undefined,
      };
    });

    reply.send({ playlists });
  });

  app.get('/api/playlists/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const { id } = request.params as { id: string };
    const { shareToken } = request.query as { shareToken?: string };
    const playlist = getPlaylistById(db, id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (!canViewPlaylist(db, playlist, userId, shareToken)) return reply.status(403).send({ error: 'Forbidden' });

    const effectiveUserId = userId ?? playlist.ownerId;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;
    const songIds = resolvePlaylistSongIds(db, playlist, effectiveUserId);
    const entries = fetchPlaylistSongs(db, songIds);
    const visibleEntries = hideExplicit ? entries.filter((s) => !(s as { explicit?: boolean }).explicit) : entries;

    const interactionRow = userId
      ? (db.prepare('SELECT starred, rating FROM user_playlists WHERE user_id = ? AND playlist_id = ?')
        .get(userId, id) as { starred: number | null; rating: number | null } | undefined)
      : undefined;

    const shares = userId === playlist.ownerId
      ? (db.prepare(`
          SELECT ps.user_id, u.username, ps.can_edit
          FROM playlist_shares ps
          JOIN users u ON u.id = ps.user_id
          WHERE ps.playlist_id = ?
          ORDER BY u.username
        `).all(id) as { user_id: string; username: string; can_edit: number }[])
        .map((row) => ({ userId: row.user_id, username: row.username, canEdit: row.can_edit === 1 }))
      : undefined;

    reply.send({
      playlist: {
        ...playlist,
        songCount: visibleEntries.length,
        entries: visibleEntries,
        starred: interactionRow?.starred === 1,
        rating: interactionRow?.rating ?? undefined,
        shares,
      },
    });
  });

  app.post('/api/playlists', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const body = request.body as {
      name: string;
      description?: string;
      visibility?: PlaylistVisibility;
      songIds?: string[];
      isSmart?: boolean;
      rules?: SmartPlaylistRules;
    };
    if (typeof body.name !== 'string' || body.name.length === 0) {
      return reply.status(400).send({ error: 'Name is required' });
    }
    const visibility = isVisibility(body.visibility) ? body.visibility : 'private';
    const isSmart = body.isSmart === true;
    let rules: SmartPlaylistRules | undefined;
    try {
      rules = isSmart ? serializeRules(body.rules) : undefined;
    } catch {
      return reply.status(400).send({ error: 'Invalid rules' });
    }
    const songIds = isSmart ? [] : Array.isArray(body.songIds) ? body.songIds : [];
    const now = new Date().toISOString();
    const playlist: Playlist = {
      id: randomUUID(),
      name: body.name,
      description: body.description,
      ownerId: userId,
      visibility,
      shareToken: visibility === 'link' ? generateShareToken() : undefined,
      songIds,
      isSmart,
      rules,
      createdAt: now,
      updatedAt: now,
    };
    createPlaylist(db, playlist);
    reply.status(201).send({ playlist });
  });

  app.put('/api/playlists/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const { id } = request.params as { id: string };
    const existing = getPlaylistById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Playlist not found' });
    if (!canEditOrOwnPlaylist(db, existing, userId)) return reply.status(403).send({ error: 'Forbidden' });

    const body = request.body as Partial<{
      name: string;
      description: string;
      visibility: PlaylistVisibility;
      songIds: string[];
      rules: SmartPlaylistRules;
      isSmart: boolean;
    }>;

    let songIds = existing.songIds;
    let isSmart = existing.isSmart;
    let rules = existing.rules;

    if (existing.isSmart && body.isSmart === false) {
      isSmart = false;
      rules = undefined;
      songIds = resolvePlaylistSongIds(db, existing, userId);
    } else if (!existing.isSmart && body.isSmart === true) {
      if (body.rules === undefined) {
        return reply.status(400).send({ error: 'Rules are required when converting to a smart playlist' });
      }
      try {
        rules = serializeRules(body.rules);
      } catch {
        return reply.status(400).send({ error: 'Invalid rules' });
      }
      // Converting to smart drops the manually curated members.
      isSmart = true;
      songIds = [];
    } else {
      if (existing.isSmart && body.songIds !== undefined) {
        return reply.status(400).send({ error: 'Cannot manually edit songs of a smart playlist' });
      }
      if (existing.isSmart && body.rules !== undefined) {
        try {
          rules = serializeRules(body.rules);
        } catch {
          return reply.status(400).send({ error: 'Invalid rules' });
        }
      }
      if (Array.isArray(body.songIds)) {
        songIds = body.songIds;
      }
    }

    const visibility = isVisibility(body.visibility) ? body.visibility : existing.visibility;
    // The share token lifecycle is managed via the share-link endpoints, not
    // visibility changes; only auto-generate for an explicit 'link' request.
    let shareToken = existing.shareToken;
    if (visibility === 'link' && !shareToken) {
      shareToken = generateShareToken();
    }

    const updated: Playlist = {
      ...existing,
      name: typeof body.name === 'string' && body.name.length > 0 ? body.name : existing.name,
      description: typeof body.description === 'string' ? body.description : existing.description,
      visibility,
      shareToken,
      isSmart,
      rules,
      songIds,
      updatedAt: new Date().toISOString(),
    };
    updatePlaylist(db, updated);
    reply.send({ playlist: updated });
  });

  app.delete('/api/playlists/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const { id } = request.params as { id: string };
    const existing = getPlaylistById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Playlist not found' });
    if (existing.ownerId !== userId) return reply.status(403).send({ error: 'Forbidden' });

    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    reply.send({ ok: true });
  });

  app.post('/api/playlists/:id/share', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const { id } = request.params as { id: string };
    const existing = getPlaylistById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Playlist not found' });
    if (existing.ownerId !== userId) return reply.status(403).send({ error: 'Forbidden' });

    const { userId: targetUserId, canEdit } = request.body as { userId: string; canEdit?: boolean };
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId) as { id: string } | undefined;
    if (!target) return reply.status(400).send({ error: 'User not found' });

    sharePlaylistWithUser(db, id, targetUserId, Boolean(canEdit));
    reply.send({ ok: true });
  });

  app.post('/api/playlists/:id/share-link', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const { id } = request.params as { id: string };
    const existing = getPlaylistById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Playlist not found' });
    if (existing.ownerId !== userId) return reply.status(403).send({ error: 'Forbidden' });

    // Always mint a fresh token: this doubles as "regenerate", invalidating
    // any previously shared link.
    const shareToken = generateShareToken();
    db.prepare('UPDATE playlists SET share_token = ? WHERE id = ?').run(shareToken, id);
    reply.send({ shareToken });
  });

  app.delete('/api/playlists/:id/share-link', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const { id } = request.params as { id: string };
    const existing = getPlaylistById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Playlist not found' });
    if (existing.ownerId !== userId) return reply.status(403).send({ error: 'Forbidden' });

    db.prepare('UPDATE playlists SET share_token = NULL WHERE id = ?').run(id);
    reply.send({ ok: true });
  });

  app.delete('/api/playlists/:id/share/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const { id, userId: targetUserId } = request.params as { id: string; userId: string };
    const existing = getPlaylistById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Playlist not found' });
    if (existing.ownerId !== userId) return reply.status(403).send({ error: 'Forbidden' });

    db.prepare('DELETE FROM playlist_shares WHERE playlist_id = ? AND user_id = ?').run(id, targetUserId);
    reply.send({ ok: true });
  });

  app.get('/api/playlists/:id/albums', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const { id } = request.params as { id: string };
    const { shareToken } = request.query as { shareToken?: string };
    const playlist = getPlaylistById(db, id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (!canViewPlaylist(db, playlist, userId, shareToken)) return reply.status(403).send({ error: 'Forbidden' });

    const effectiveUserId = userId ?? playlist.ownerId;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;
    const songIds = resolvePlaylistSongIds(db, playlist, effectiveUserId);
    if (songIds.length === 0) return reply.send({ albums: [] });

    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(query.limit ?? '4', 10) || 4, 1), 20);

    const explicitFilter = hideExplicit
      ? 'AND EXISTS (SELECT 1 FROM songs s2 WHERE s2.album_id = a.id AND s2.active = 1 AND s2.explicit = 0)'
      : '';

    const byId = new Map<string, DbAlbum>();
    for (let i = 0; i < songIds.length; i += SQLITE_VARIABLE_CHUNK) {
      const chunk = songIds.slice(i, i + SQLITE_VARIABLE_CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT a.*
        FROM albums a
        JOIN songs s ON s.album_id = a.id
        WHERE s.id IN (${placeholders}) AND a.active = 1
        ${explicitFilter}
        GROUP BY a.id
      `).all(...chunk) as DbAlbum[];
      for (const row of rows) {
        byId.set(row.id, row);
      }
    }

    const rows = Array.from(byId.values())
      .sort(() => Math.random() - 0.5)
      .slice(0, limit);

    reply.send({ albums: rows.map(toAlbum) });
  });
}
