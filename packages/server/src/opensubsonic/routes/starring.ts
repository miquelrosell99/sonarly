import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { sendSubsonicReply } from '../responses.js';

export function registerStarringRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/star.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id } = request.query as { id: string | string[] };
    for (const songId of normalizeIds(id)) {
      setStar(db, userId, songId, true);
    }
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/unstar.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id } = request.query as { id: string | string[] };
    for (const songId of normalizeIds(id)) {
      setStar(db, userId, songId, false);
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
    sendSubsonicReply(reply, format, {});
  });

  app.get('/rest/scrobble.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat;
    const userId = (request as any).subsonicUser;
    const { id } = request.query as { id: string | string[] };
    const stmt = db.prepare(`
      INSERT INTO user_songs (user_id, song_id, play_count, last_played) VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, song_id) DO UPDATE SET
        play_count = play_count + 1,
        last_played = datetime('now')
    `);
    for (const songId of normalizeIds(id)) {
      stmt.run(userId, songId);
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

function setStar(db: Database.Database, userId: string, songId: string, starred: boolean): void {
  db.prepare(`
    INSERT INTO user_songs (user_id, song_id, starred) VALUES (?, ?, ?)
    ON CONFLICT(user_id, song_id) DO UPDATE SET starred = excluded.starred
  `).run(userId, songId, starred ? 1 : 0);
}
