import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { Config } from '../config.js';
import { organizeExistingLibrary } from '../ingest/organize-existing.js';

export function registerOrganizeManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.post('/api/organize', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await organizeExistingLibrary(config, db);
    reply.send({ stats });
  });

  app.get('/api/organize/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ pattern: config.ORGANIZE_PATTERN });
  });
}
