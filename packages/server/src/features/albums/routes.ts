import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { SongTags, Album } from '@sonarly/shared';
import { listSongsByAlbum } from '../songs/index.js';
import { getUserPreferences } from '../user-preferences/index.js';
import { writeTags } from '../tags/index.js';
import { validateSongTags, queueResync } from '../songs/index.js';
import { organizeSongFile } from '../ingest/index.js';
import type { Config } from '../../config.js';

interface AlbumRow {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  year: number | null;
  genre: string | null;
  cover_art: string | null;
  starred: number | null;
  rating: number | null;
}

function rowToAlbum(row: AlbumRow): Album {
  return {
    id: row.id,
    name: row.name,
    artistId: row.artist_id ?? undefined,
    artistName: row.artist_name ?? undefined,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    coverArt: row.cover_art ?? undefined,
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
  };
}

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerAlbumManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/api/albums', (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserPreferences(db, userId).hideExplicit === true : false;

    const rows = db.prepare(`
      SELECT
        a.*,
        ua.starred,
        ua.rating,
        COUNT(s.id) AS total_song_count,
        SUM(CASE WHEN s.explicit = 0 THEN 1 ELSE 0 END) AS shown_song_count
      FROM albums a
      LEFT JOIN songs s ON s.album_id = a.id
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      ${hideExplicit ? 'GROUP BY a.id HAVING shown_song_count > 0' : 'GROUP BY a.id'}
      ORDER BY a.name
      LIMIT 500
    `).all(userId ?? null) as (AlbumRow & { total_song_count: number; shown_song_count: number })[];

    reply.send({
      albums: rows.map((row) => ({
        ...rowToAlbum(row),
        totalSongCount: row.total_song_count,
        shownSongCount: row.shown_song_count,
      })),
    });
  });

  app.put('/api/albums/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as Album | undefined;
    if (!album) return reply.status(404).send({ error: 'Album not found' });

    let tags: SongTags;
    try {
      tags = validateSongTags(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid tags' });
    }

    const songs = listSongsByAlbum(db, id);
    for (const song of songs) {
      await writeTags(song.filePath, tags);

      let newPath: string;
      try {
        newPath = await organizeSongFile(config, db, song.filePath);
      } catch (err) {
        request.log.error({ err }, `Failed to organize file after album tag write for ${song.filePath}`);
        return reply.status(500).send({ error: 'Tags were saved but a file could not be reorganized' });
      }

      try {
        queueResync(db, newPath);
      } catch (err) {
        request.log.error({ err }, 'Failed to queue resync job after album tag write');
        return reply.status(500).send({ error: 'Tags saved and files reorganized, but resync queue failed' });
      }
    }

    reply.send({ updated: songs.length });
  });

  app.get('/api/albums/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserPreferences(db, userId).hideExplicit === true : false;

    const row = db.prepare(`
      SELECT a.*, ua.starred, ua.rating
      FROM albums a
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.id = ?
    `).get(userId ?? null, id) as AlbumRow | undefined;
    if (!row) return reply.status(404).send({ error: 'Album not found' });

    const songs = listSongsByAlbum(db, id, userId);
    const visibleSongs = hideExplicit ? songs.filter((s) => !s.explicit) : songs;

    reply.send({
      album: {
        ...rowToAlbum(row),
        totalSongCount: songs.length,
        shownSongCount: visibleSongs.length,
      },
      songs: visibleSongs,
    });
  });
}
