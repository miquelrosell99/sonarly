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
import { getUserPreferences } from '../user-preferences/index.js';

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
  album_name: string | null;
  artist_name: string | null;
}

function fetchPlaylistSongs(db: Database.Database, songIds: string[]): Record<string, unknown>[] {
  if (songIds.length === 0) return [];
  const rows = db.prepare(`
    SELECT s.*, a.name AS album_name, ar.name AS artist_name
    FROM songs s
    LEFT JOIN albums a ON a.id = s.album_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    WHERE s.id IN (${songIds.map(() => '?').join(',')})
  `).all(...songIds) as PlaylistSongRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return songIds
    .map((id) => byId.get(id))
    .filter((row): row is PlaylistSongRow => row !== undefined)
    .map((song) => ({
      id: song.id,
      title: song.title,
      album: song.album_name ?? '',
      artist: song.artist_name ?? '',
      track: song.track_number,
      discNumber: song.disc_number,
      genre: song.genre,
      year: song.year,
      explicit: song.explicit === 1,
      duration: song.duration,
      type: 'music',
      isDir: false,
      created: new Date(song.mtime).toISOString(),
    }));
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
         OR p.visibility IN ('public', 'link')
         OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id AND ps.user_id = ?)
      ORDER BY p.updated_at DESC
    `).all(userId, userId, userId) as PlaylistListRow[];

    const playlists = rows.map((r) => {
      const isSmart = r.is_smart === 1;
      const base = getPlaylistById(db, r.id)!;
      return {
        id: r.id,
        name: r.name,
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
    const hideExplicit = userId ? getUserPreferences(db, userId).hideExplicit === true : false;
    const songIds = resolvePlaylistSongIds(db, playlist, effectiveUserId);
    const entries = fetchPlaylistSongs(db, songIds);
    const visibleEntries = hideExplicit ? entries.filter((s) => !(s as { explicit?: boolean }).explicit) : entries;

    const interactionRow = effectiveUserId
      ? (db.prepare('SELECT starred, rating FROM user_playlists WHERE user_id = ? AND playlist_id = ?')
        .get(effectiveUserId, id) as { starred: number | null; rating: number | null } | undefined)
      : undefined;

    reply.send({
      playlist: {
        ...playlist,
        songCount: visibleEntries.length,
        entries: visibleEntries,
        starred: interactionRow?.starred === 1,
        rating: interactionRow?.rating ?? undefined,
      },
    });
  });

  app.post('/api/playlists', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const body = request.body as {
      name: string;
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
      visibility: PlaylistVisibility;
      songIds: string[];
      rules: SmartPlaylistRules;
    }>;

    if (existing.isSmart && body.songIds !== undefined) {
      return reply.status(400).send({ error: 'Cannot manually edit songs of a smart playlist' });
    }

    let rules = existing.rules;
    if (existing.isSmart && body.rules !== undefined) {
      try {
        rules = serializeRules(body.rules);
      } catch {
        return reply.status(400).send({ error: 'Invalid rules' });
      }
    }

    const visibility = isVisibility(body.visibility) ? body.visibility : existing.visibility;
    let shareToken = existing.shareToken;
    if (visibility === 'link' && !shareToken) {
      shareToken = generateShareToken();
    } else if (visibility !== 'link') {
      shareToken = undefined;
    }

    const updated: Playlist = {
      ...existing,
      name: typeof body.name === 'string' && body.name.length > 0 ? body.name : existing.name,
      visibility,
      shareToken,
      songIds: Array.isArray(body.songIds) ? body.songIds : existing.songIds,
      rules,
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

  app.delete('/api/playlists/:id/share/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const { id, userId: targetUserId } = request.params as { id: string; userId: string };
    const existing = getPlaylistById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Playlist not found' });
    if (existing.ownerId !== userId) return reply.status(403).send({ error: 'Forbidden' });

    db.prepare('DELETE FROM playlist_shares WHERE playlist_id = ? AND user_id = ?').run(id, targetUserId);
    reply.send({ ok: true });
  });
}
