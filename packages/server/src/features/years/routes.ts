import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';

export function registerYearRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/years', (request: FastifyRequest, reply: FastifyReply) => {
    const rows = db.prepare(`
      SELECT DISTINCT year AS value
      FROM (
        SELECT year FROM songs WHERE active = 1 AND year IS NOT NULL
        UNION
        SELECT year FROM albums WHERE active = 1 AND year IS NOT NULL
      )
      ORDER BY value DESC
    `).all() as { value: number }[];

    reply.send({ years: rows.map((r) => r.value) });
  });
}
