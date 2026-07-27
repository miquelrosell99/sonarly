import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';

export function registerYearRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/years', (request: FastifyRequest, reply: FastifyReply) => {
    const { libraryId } = request.query as { libraryId?: string };
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;

    const params: (string | null)[] = [];
    if (libraryFilter) params.push(libraryId);
    if (libraryFilter) params.push(libraryId);

    const rows = db.prepare(`
      SELECT DISTINCT year AS value
      FROM (
        SELECT year FROM songs WHERE active = 1 AND year IS NOT NULL ${libraryFilter ? 'AND library_id = ?' : ''}
        UNION
        SELECT year FROM albums WHERE active = 1 AND year IS NOT NULL ${libraryFilter ? 'AND EXISTS (SELECT 1 FROM songs s WHERE s.album_id = albums.id AND s.active = 1 AND s.library_id = ?)' : ''}
      )
      ORDER BY value DESC
    `).all(...params) as { value: number }[];

    reply.send({ years: rows.map((r) => r.value) });
  });
}
