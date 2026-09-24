import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { getLibraryScope, libraryScopeCondition } from '../libraries/policy.js';

export function registerYearRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/years', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId?: string; isAdmin?: boolean } | undefined;
    const scope = getLibraryScope(db, session);
    const songScopeCondition = libraryScopeCondition(scope, 'library_id');
    const albumScopeCondition = libraryScopeCondition(scope, 's.library_id');
    const { libraryId } = request.query as { libraryId?: string };
    const libraryFilter = typeof libraryId === 'string' && libraryId.length > 0;
    const albumScopeSql = scope.all
      ? ''
      : `AND EXISTS (SELECT 1 FROM songs s WHERE s.album_id = albums.id AND s.active = 1 ${albumScopeCondition.sql})`;

    const params: (string | null)[] = [];
    if (libraryFilter) params.push(libraryId);
    params.push(...songScopeCondition.params);
    if (libraryFilter) params.push(libraryId);
    params.push(...albumScopeCondition.params);

    const rows = db.prepare(`
      SELECT DISTINCT year AS value
      FROM (
        SELECT year FROM songs WHERE active = 1 AND year IS NOT NULL ${libraryFilter ? 'AND library_id = ?' : ''} ${songScopeCondition.sql}
        UNION
        SELECT year FROM albums WHERE active = 1 AND year IS NOT NULL ${libraryFilter ? 'AND EXISTS (SELECT 1 FROM songs s WHERE s.album_id = albums.id AND s.active = 1 AND s.library_id = ?)' : ''} ${albumScopeSql}
      )
      ORDER BY value DESC
    `).all(...params) as { value: number }[];

    reply.send({ years: rows.map((r) => r.value) });
  });
}
