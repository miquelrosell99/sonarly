import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import type { UserPreferences, AutoDjMode } from '@sonarly/shared';
import { DEFAULT_USER_PREFERENCES } from '@sonarly/shared';
import { getUserPreferences, updateUserPreferences } from './repository.js';

const AUTO_DJ_MODES: AutoDjMode[] = ['similar', 'random', 'smart'];

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

    if (body.autoDjEnabled !== undefined) {
      normalized.autoDjEnabled = Boolean(body.autoDjEnabled);
    }

    if (body.autoDjMode !== undefined) {
      const mode = String(body.autoDjMode);
      normalized.autoDjMode = AUTO_DJ_MODES.includes(mode as AutoDjMode)
        ? (mode as AutoDjMode)
        : DEFAULT_USER_PREFERENCES.autoDjMode;
    }

    const preferences = updateUserPreferences(db, session.userId, normalized);
    reply.send({ preferences });
  });
}
