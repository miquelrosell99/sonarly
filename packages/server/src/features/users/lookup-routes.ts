import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';

const LOOKUP_LIMIT = 10;
const MAX_QUERY_LENGTH = 100;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => '\\' + ch);
}

export function registerUserLookupRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/users/lookup', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session.userId as string;
    const { q } = request.query as { q?: string };
    const query = (q ?? '').trim().slice(0, MAX_QUERY_LENGTH);

    // NOTE: keep the ESCAPE clause in a plain single-quoted string — in a
    // template literal the backslash in ESCAPE '\' would be consumed by JS
    // before SQLite ever sees it.
    const rows = db.prepare(
      'SELECT id, username FROM users WHERE id != ? AND username LIKE ? ESCAPE \'\\\' ORDER BY username LIMIT ?',
    ).all(userId, `%${escapeLike(query)}%`, LOOKUP_LIMIT) as { id: string; username: string }[];

    reply.send({ users: rows });
  });
}
