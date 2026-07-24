import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';

const ALLOWED_FIELDS = new Set(['artist', 'album', 'genre', 'albumArtist']);
const MAX_LIMIT = 50;

interface SuggestionParams {
  field: string;
  q?: string;
  limit?: string;
}

function getSuggestions(db: Database.Database, field: string, query: string, limit: number): string[] {
  const like = `%${query}%`;
  if (field === 'artist') {
    const rows = db.prepare('SELECT name FROM artists WHERE active = 1 AND name LIKE ? COLLATE NOCASE ORDER BY name LIMIT ?')
      .all(like, limit) as { name: string }[];
    return rows.map((r) => r.name);
  }
  if (field === 'album') {
    const rows = db.prepare('SELECT name FROM albums WHERE active = 1 AND name LIKE ? COLLATE NOCASE ORDER BY name LIMIT ?')
      .all(like, limit) as { name: string }[];
    return rows.map((r) => r.name);
  }
  if (field === 'albumArtist') {
    const rows = db.prepare("SELECT DISTINCT artist_name AS name FROM albums WHERE active = 1 AND artist_name IS NOT NULL AND artist_name LIKE ? COLLATE NOCASE ORDER BY artist_name LIMIT ?")
      .all(like, limit) as { name: string }[];
    return rows.map((r) => r.name);
  }
  // genre
  const rows = db.prepare(`
    SELECT name FROM (
      SELECT DISTINCT genre AS name FROM songs WHERE active = 1 AND genre IS NOT NULL
      UNION
      SELECT DISTINCT genre AS name FROM albums WHERE active = 1 AND genre IS NOT NULL
    )
    WHERE name LIKE ? COLLATE NOCASE
    ORDER BY name
    LIMIT ?
  `).all(like, limit) as { name: string }[];
  return rows.map((r) => r.name);
}

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerSuggestionRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/suggestions', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { field, q = '', limit } = request.query as SuggestionParams;

    if (!ALLOWED_FIELDS.has(field)) {
      return reply.status(400).send({ error: `Unsupported suggestion field: ${field}` });
    }

    const parsedLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIMIT);
    const suggestions = getSuggestions(db, field, q.trim(), parsedLimit);
    reply.send({ suggestions });
  });
}
