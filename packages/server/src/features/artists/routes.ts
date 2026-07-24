import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { getUserPreferences } from '../user-preferences/index.js';
import { listSongsByArtist } from '../songs/index.js';

interface ArtistRow {
  id: string;
  name: string;
  active: number;
  starred: number | null;
  rating: number | null;
}

interface AlbumRow {
  id: string;
  name: string;
  year: number | null;
  genre: string | null;
  starred: number | null;
  rating: number | null;
}

export function registerArtistManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/artists', (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const rows = db.prepare(`
      SELECT ar.*, ua.starred, ua.rating
      FROM artists ar
      LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
      WHERE ar.active = 1
      ORDER BY ar.name
    `).all(userId ?? null) as ArtistRow[];
    reply.send({
      artists: rows.map((r) => ({
        id: r.id,
        name: r.name,
        active: r.active === 1,
        starred: r.starred === 1,
        rating: r.rating ?? undefined,
      })),
    });
  });

  app.get('/api/artists/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserPreferences(db, userId).hideExplicit === true : false;

    const artist = db.prepare(`
      SELECT ar.*, ua.starred, ua.rating
      FROM artists ar
      LEFT JOIN user_artists ua ON ua.user_id = ? AND ua.artist_id = ar.id
      WHERE ar.id = ? AND ar.active = 1
    `).get(userId ?? null, id) as ArtistRow | undefined;
    if (!artist) return reply.status(404).send({ error: 'Artist not found' });

    const albums = db.prepare(`
      SELECT a.id, a.name, a.year, a.genre, ua.starred, ua.rating,
        COUNT(s.id) AS total_song_count,
        SUM(CASE WHEN s.explicit = 0 THEN 1 ELSE 0 END) AS shown_song_count
      FROM albums a
      LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1
      LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id
      WHERE a.artist_id = ? AND a.active = 1
      ${hideExplicit ? 'GROUP BY a.id HAVING shown_song_count > 0' : 'GROUP BY a.id'}
      ORDER BY a.year, a.name
    `).all(userId ?? null, id) as (AlbumRow & { total_song_count: number; shown_song_count: number })[];

    reply.send({
      artist: {
        id: artist.id,
        name: artist.name,
        active: artist.active === 1,
        starred: artist.starred === 1,
        rating: artist.rating ?? undefined,
        albums: albums.map((a) => ({
          id: a.id,
          name: a.name,
          year: a.year ?? undefined,
          genre: a.genre ?? undefined,
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
    const hideExplicit = userId ? getUserPreferences(db, userId).hideExplicit === true : false;

    const artist = db.prepare('SELECT id FROM artists WHERE id = ? AND active = 1').get(id) as { id: string } | undefined;
    if (!artist) return reply.status(404).send({ error: 'Artist not found' });

    const songs = listSongsByArtist(db, id, userId);
    const visibleSongs = hideExplicit ? songs.filter((s) => !s.explicit) : songs;
    reply.send({ songs: visibleSongs });
  });
}
