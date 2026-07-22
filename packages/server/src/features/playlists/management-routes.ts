import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Playlist, PlaylistVisibility } from '@sonarly/shared';
import {
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  sharePlaylistWithUser,
  generateShareToken,
} from '../playlists/index.js';

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
  created_at: string;
  updated_at: string;
  song_count: number;
}

interface PlaylistSongRow {
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
      duration: song.duration,
      type: 'music',
      isDir: false,
      created: new Date(song.mtime).toISOString(),
    }));
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
        p.created_at,
        p.updated_at,
        (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count
      FROM playlists p
      JOIN users u ON u.id = p.owner_id
      WHERE p.owner_id = ?
         OR p.visibility IN ('public', 'link')
         OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id AND ps.user_id = ?)
      ORDER BY p.updated_at DESC
    `).all(userId, userId) as PlaylistListRow[];

    reply.send({
      playlists: rows.map((r) => ({
        id: r.id,
        name: r.name,
        ownerId: r.owner_id,
        ownerUsername: r.owner_username,
        visibility: r.visibility,
        shareToken: r.owner_id === userId ? (r.share_token ?? undefined) : undefined,
        songCount: r.song_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  app.get('/api/playlists/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const { id } = request.params as { id: string };
    const { shareToken } = request.query as { shareToken?: string };
    const playlist = getPlaylistById(db, id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (!canViewPlaylist(db, playlist, userId, shareToken)) return reply.status(403).send({ error: 'Forbidden' });

    reply.send({
      playlist: {
        ...playlist,
        entries: fetchPlaylistSongs(db, playlist.songIds),
      },
    });
  });

  app.post('/api/playlists', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const body = request.body as {
      name: string;
      visibility?: PlaylistVisibility;
      songIds?: string[];
    };
    if (typeof body.name !== 'string' || body.name.length === 0) {
      return reply.status(400).send({ error: 'Name is required' });
    }
    const visibility = isVisibility(body.visibility) ? body.visibility : 'private';
    const songIds = Array.isArray(body.songIds) ? body.songIds : [];
    const now = new Date().toISOString();
    const playlist: Playlist = {
      id: randomUUID(),
      name: body.name,
      ownerId: userId,
      visibility,
      shareToken: visibility === 'link' ? generateShareToken() : undefined,
      songIds,
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
    }>;

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
