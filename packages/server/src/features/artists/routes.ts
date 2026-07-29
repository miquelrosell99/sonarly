import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import mime from 'mime-types';
import { getUserById } from '../users/index.js';
import { listSongsByArtist } from '../songs/index.js';
import { deleteArtistById } from './repository.js';
import { deleteAlbumById } from '../albums/repository.js';

interface ArtistRow {
  id: string;
  name: string;
  active: number;
  starred: number | null;
  rating: number | null;
  artist_image_local_path: string | null;
  musicbrainz_artist_ids: string | null;
  bio: string | null;
  external_urls: string | null;
}

interface AlbumRow {
  id: string;
  name: string;
  year: number | null;
  genre: string | null;
  starred: number | null;
  rating: number | null;
  cover_art_id: string | null;
}

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerArtistManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/artists', (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const { libraryId } = request.query as { libraryId?: string };
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;

    const rows = db.prepare(`
      SELECT ar.*, ua.starred, ua.rating
      FROM artists ar
      LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
      ${libraryFilter ? 'JOIN songs s ON s.artist_id = ar.id AND s.active = 1 AND s.library_id = ?' : ''}
      WHERE ar.active = 1
      ${libraryFilter ? 'GROUP BY ar.id' : ''}
      ORDER BY ar.name
    `).all(...(libraryFilter ? [userId ?? null, libraryId] : [userId ?? null])) as ArtistRow[];
    reply.send({
      artists: rows.map((r) => ({
        id: r.id,
        name: r.name,
        active: r.active === 1,
        starred: r.starred === 1,
        rating: r.rating ?? undefined,
        musicBrainzArtistIds: r.musicbrainz_artist_ids ? JSON.parse(r.musicbrainz_artist_ids) : undefined,
        bio: r.bio ?? undefined,
        externalUrls: r.external_urls ? JSON.parse(r.external_urls) : undefined,
      })),
    });
  });

  app.get('/api/artists/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;
    const { libraryId } = request.query as { libraryId?: string };
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;

    const artist = db.prepare(`
      SELECT ar.*, ua.starred, ua.rating
      FROM artists ar
      LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
      WHERE ar.id = ? AND ar.active = 1
      ${libraryFilter ? 'AND EXISTS (SELECT 1 FROM songs s WHERE s.artist_id = ar.id AND s.active = 1 AND s.library_id = ?)' : ''}
    `).get(...(libraryFilter ? [userId ?? null, id, libraryId] : [userId ?? null, id])) as ArtistRow | undefined;
    if (!artist) return reply.status(404).send({ error: 'Artist not found' });

    const albums = db.prepare(`
      SELECT a.id, a.name, a.year, a.genre, a.cover_art_id, ua.starred, ua.rating,
        COUNT(s.id) AS total_song_count,
        SUM(CASE WHEN ? = 1 AND s.explicit = 1 THEN 0 ELSE 1 END) AS shown_song_count
      FROM albums a
      LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1 ${libraryFilter ? 'AND s.library_id = ?' : ''}
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.artist_id = ? AND a.active = 1
      ${hideExplicit ? 'GROUP BY a.id HAVING shown_song_count > 0' : 'GROUP BY a.id'}
      ORDER BY a.year, a.name
    `).all(...(libraryFilter ? [hideExplicit ? 1 : 0, libraryId, userId ?? null, id] : [hideExplicit ? 1 : 0, userId ?? null, id])) as (AlbumRow & { total_song_count: number; shown_song_count: number })[];

    reply.send({
      artist: {
        id: artist.id,
        name: artist.name,
        active: artist.active === 1,
        starred: artist.starred === 1,
        rating: artist.rating ?? undefined,
        musicBrainzArtistIds: artist.musicbrainz_artist_ids ? JSON.parse(artist.musicbrainz_artist_ids) : undefined,
        bio: artist.bio ?? undefined,
        externalUrls: artist.external_urls ? JSON.parse(artist.external_urls) : undefined,
        artistImageUrl: artist.artist_image_local_path ? `/api/artist-images/${artist.id}` : undefined,
        albums: albums.map((a) => ({
          id: a.id,
          name: a.name,
          year: a.year ?? undefined,
          genre: a.genre ?? undefined,
          coverArt: a.cover_art_id ?? undefined,
          totalSongCount: a.total_song_count,
          shownSongCount: a.shown_song_count,
          starred: a.starred === 1,
          rating: a.rating ?? undefined,
        })),
      },
    });
  });

  app.get('/api/artists/:id/songs', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;
    const { libraryId } = request.query as { libraryId?: string };
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;

    const artist = db.prepare(`
      SELECT id FROM artists ar
      WHERE ar.id = ? AND ar.active = 1
      ${libraryFilter ? 'AND EXISTS (SELECT 1 FROM songs s WHERE s.artist_id = ar.id AND s.active = 1 AND s.library_id = ?)' : ''}
    `).get(...(libraryFilter ? [id, libraryId] : [id])) as { id: string } | undefined;
    if (!artist) return reply.status(404).send({ error: 'Artist not found' });

    const songs = listSongsByArtist(db, id, userId, libraryFilter ? libraryId : undefined);
    const visibleSongs = hideExplicit ? songs.filter((s) => !s.explicit) : songs;
    reply.send({ songs: visibleSongs });
  });

  app.get('/api/artist-images/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const row = db
      .prepare('SELECT artist_image_local_path FROM artists WHERE id = ? AND active = 1')
      .get(id) as { artist_image_local_path: string | null } | undefined;
    if (!row?.artist_image_local_path) {
      return reply.status(404).send({ error: 'Artist image not found' });
    }

    try {
      const fileStat = await stat(row.artist_image_local_path);
      if (!fileStat.isFile()) {
        return reply.status(404).send({ error: 'Artist image not found' });
      }
    } catch {
      return reply.status(404).send({ error: 'Artist image not found' });
    }

    const contentType = mime.lookup(row.artist_image_local_path) || 'application/octet-stream';
    reply.header('Content-Type', contentType);
    return reply.send(createReadStream(row.artist_image_local_path));
  });

  app.delete('/api/artists/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const artist = db.prepare('SELECT id FROM artists WHERE id = ? AND active = 1').get(id) as { id: string } | undefined;
    if (!artist) return reply.status(404).send({ error: 'Artist not found' });

    const songs = listSongsByArtist(db, id);
    if (songs.length > 0) {
      return reply.status(409).send({ error: 'Cannot delete artist with active songs' });
    }

    const emptyAlbums = db.prepare(`
      SELECT a.id
      FROM albums a
      LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1
      WHERE a.artist_id = ? AND a.active = 1 AND s.id IS NULL
    `).all(id) as { id: string }[];
    for (const album of emptyAlbums) {
      deleteAlbumById(db, album.id);
    }

    deleteArtistById(db, id);
    reply.send({ ok: true, deletedAlbums: emptyAlbums.length });
  });
}
