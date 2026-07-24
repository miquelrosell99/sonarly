import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { UserPreferences } from '@sonarly/shared';
import { getUserPreferences, updateUserPreferences } from './repository.js';

export function registerUserPreferenceRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/me/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string } | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });
    reply.send({ preferences: getUserPreferences(db, session.userId) });
  });

  app.patch('/api/me/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string } | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const body = request.body as Partial<UserPreferences>;
    const preferences = updateUserPreferences(db, session.userId, body);
    reply.send({ preferences });
  });
}
