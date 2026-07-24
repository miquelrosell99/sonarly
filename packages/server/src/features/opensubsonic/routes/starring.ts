import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { sendSubsonicReply } from '../responses.js';
import { scrobbleSong } from '../../songs/index.js';

export function registerStarringRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/star.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id, albumId, artistId } = request.query as {
      id?: string | string[];
      albumId?: string | string[];
      artistId?: string | string[];
    };
    for (const songId of normalizeIds(id)) {
      setStar(db, userId, 'user_songs', 'song_id', songId, true);
    }
    for (const aId of normalizeIds(albumId)) {
      setStar(db, userId, 'user_albums', 'album_id', aId, true);
    }
    for (const aId of normalizeIds(artistId)) {
      setStar(db, userId, 'user_artists', 'artist_id', aId, true);
    }
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/unstar.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id, albumId, artistId } = request.query as {
      id?: string | string[];
      albumId?: string | string[];
      artistId?: string | string[];
    };
    for (const songId of normalizeIds(id)) {
      setStar(db, userId, 'user_songs', 'song_id', songId, false);
    }
    for (const aId of normalizeIds(albumId)) {
      setStar(db, userId, 'user_albums', 'album_id', aId, false);
    }
    for (const aId of normalizeIds(artistId)) {
      setStar(db, userId, 'user_artists', 'artist_id', aId, false);
    }
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/setRating.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id, rating } = request.query as { id: string; rating: string | string[] };

    const ratingValue = parseRating(rating);
    if (ratingValue === undefined) {
      return sendSubsonicReply(reply, format, {
        error: { code: 10, message: 'Missing or invalid rating parameter' },
      }, 'failed');
    }

    db.prepare(`
      INSERT INTO user_songs (user_id, song_id, rating) VALUES (?, ?, ?)
      ON CONFLICT(user_id, song_id) DO UPDATE SET rating = excluded.rating
    `).run(userId, id, ratingValue);

    db.prepare(`
      UPDATE songs
      SET average_rating = (SELECT AVG(rating) FROM user_songs WHERE song_id = ?)
      WHERE id = ?
    `).run(id, id);

    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/scrobble.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id } = request.query as { id: string | string[] };
    for (const songId of normalizeIds(id)) {
      scrobbleSong(db, userId, songId, { client: 'subsonic' });
    }
    sendSubsonicReply(reply, format, {});
  });
}

function normalizeIds(value: string | string[] | undefined): string[] {
  if (value === undefined || value === '') return [];
  return Array.isArray(value) ? value.filter((v) => v !== '') : [value];
}

function parseRating(value: string | string[] | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const num = parseInt(raw, 10);
  if (num < 0 || num > 5) return undefined;
  return num;
}

function setStar(
  db: Database.Database,
  userId: string,
  table: string,
  idColumn: string,
  entityId: string,
  starred: boolean,
): void {
  db.prepare(`
    INSERT INTO ${table} (user_id, ${idColumn}, starred) VALUES (?, ?, ?)
    ON CONFLICT(user_id, ${idColumn}) DO UPDATE SET starred = excluded.starred
  `).run(userId, entityId, starred ? 1 : 0);
}
