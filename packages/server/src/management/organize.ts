import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { Config } from '../config.js';
import { getOrganizePattern } from '../db/repositories/settings-repository.js';
import { organizeExistingLibrary } from '../ingest/organize-existing.js';

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerOrganizeManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.post('/api/organize', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const stats = await organizeExistingLibrary(config, db);
    reply.send({ stats });
  });

  app.get('/api/organize/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ pattern: getOrganizePattern(db, config) });
  });
}
