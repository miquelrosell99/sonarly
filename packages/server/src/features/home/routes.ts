import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { Album } from '@sonarly/shared';
import { getUserById } from '../users/index.js';
import { getCoverArtById } from '../cover-art/index.js';

interface AlbumRow {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  year: number | null;
  genre: string | null;
  cover_art_id: string | null;
  active: number;
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
    coverArt: row.cover_art_id ?? undefined,
    active: row.active === 1,
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
  };
}

const HOME_LIMIT = 10;

const ALBUM_COLUMNS = `
  a.id, a.name, a.artist_id, a.artist_name, a.year, a.genre, a.active, a.cover_art_id
`;

export function registerHomeRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/home', (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    const hideExplicit = userId ? getUserById(db, userId)?.hideExplicit === true : false;

    const genres = db.prepare(`
      SELECT name FROM (
        SELECT DISTINCT genre AS name FROM songs WHERE active = 1 AND genre IS NOT NULL AND genre != ''
        UNION
        SELECT DISTINCT genre AS name FROM albums WHERE active = 1 AND genre IS NOT NULL AND genre != ''
      )
      ORDER BY name
    `).pluck().all() as string[];

    const explicitHaving = hideExplicit
      ? 'HAVING SUM(CASE WHEN s.explicit = 0 THEN 1 ELSE 0 END) > 0'
      : '';

    const mostPlayedRows = db.prepare(`
      SELECT ${ALBUM_COLUMNS}, ua.starred, ua.rating, COALESCE(SUM(us.play_count), 0) AS total_plays
      FROM albums a
      JOIN songs s ON s.album_id = a.id AND s.active = 1
      LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
      LEFT JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ?
      WHERE a.active = 1
      GROUP BY a.id
      ${explicitHaving}
      ORDER BY total_plays DESC, a.name
      LIMIT ?
    `).all(userId ?? null, userId ?? null, HOME_LIMIT) as (AlbumRow & { total_plays: number })[];

    const randomRows = db.prepare(`
      SELECT ${ALBUM_COLUMNS}, ua.starred, ua.rating
      FROM albums a
      LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1
      LEFT JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ?
      WHERE a.active = 1
      GROUP BY a.id
      ${explicitHaving}
      ORDER BY RANDOM()
      LIMIT ?
    `).all(userId ?? null, HOME_LIMIT) as AlbumRow[];

    const recentlyAddedRows = db.prepare(`
      SELECT ${ALBUM_COLUMNS}, ua.starred, ua.rating, MAX(s.mtime) AS last_mtime
      FROM albums a
      JOIN songs s ON s.album_id = a.id AND s.active = 1
      LEFT JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ?
      WHERE a.active = 1
      GROUP BY a.id
      ${explicitHaving}
      ORDER BY last_mtime DESC, a.name
      LIMIT ?
    `).all(userId ?? null, HOME_LIMIT) as (AlbumRow & { last_mtime: number })[];

    const recentlyPlayedRows = db.prepare(`
      SELECT ${ALBUM_COLUMNS}, ua.starred, ua.rating, MAX(us.last_played) AS last_played
      FROM albums a
      JOIN songs s ON s.album_id = a.id AND s.active = 1
      LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
      LEFT JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ?
      WHERE a.active = 1
      GROUP BY a.id
      HAVING last_played IS NOT NULL
      ORDER BY last_played DESC, a.name
      LIMIT ?
    `).all(userId ?? null, userId ?? null, HOME_LIMIT) as (AlbumRow & { last_played: string })[];

    reply.send({
      genres,
      mostPlayed: mostPlayedRows.map(rowToAlbum),
      random: randomRows.map(rowToAlbum),
      recentlyAdded: recentlyAddedRows.map(rowToAlbum),
      recentlyPlayed: recentlyPlayedRows.map(rowToAlbum),
    });
  });

  app.get('/api/cover-art/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const coverArt = getCoverArtById(db, id);
    if (!coverArt) {
      return reply.status(404).send('Not found');
    }
    return reply.type(coverArt.format).send(coverArt.data);
  });
}
