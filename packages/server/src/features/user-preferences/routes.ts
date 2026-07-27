import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { UserPreferences } from '@sonarly/shared';
import { DEFAULT_USER_PREFERENCES } from '@sonarly/shared';
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
    const normalized: Partial<UserPreferences> = { ...body };

    if (body.autoDjTopUpThreshold !== undefined) {
      const value = Number(body.autoDjTopUpThreshold);
      normalized.autoDjTopUpThreshold = Number.isFinite(value)
        ? Math.min(20, Math.max(1, value))
        : DEFAULT_USER_PREFERENCES.autoDjTopUpThreshold;
    }

    if (body.autoDjBatchSize !== undefined) {
      const value = Number(body.autoDjBatchSize);
      normalized.autoDjBatchSize = Number.isFinite(value)
        ? Math.min(50, Math.max(1, value))
        : DEFAULT_USER_PREFERENCES.autoDjBatchSize;
    }

    const preferences = updateUserPreferences(db, session.userId, normalized);
    reply.send({ preferences });
  });
}
