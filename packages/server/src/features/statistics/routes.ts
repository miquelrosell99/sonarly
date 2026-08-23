import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { getUserStatistics, getOverallStatistics, getMonthlyGroupedPlays } from './repository.js';

const rangeSchema = z.enum(['7d', '30d', '90d', '1y', 'all']).default('all');
const groupBySchema = z.enum(['artist', 'genre', 'year', 'rating', 'favorite']).default('artist');

function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): { userId: string; isAdmin: boolean } | undefined {
  const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
  if (!session?.userId) {
    reply.status(401).send({ error: 'Unauthorized' });
    return undefined;
  }
  return session;
}

function parseRange(query: unknown): '7d' | '30d' | '90d' | '1y' | 'all' {
  const parsed = rangeSchema.safeParse(query);
  return parsed.success ? parsed.data : 'all';
}

export function registerStatisticsRoutes(app: FastifyInstance, db: Database.Database, _config: Config): void {
  app.get('/api/statistics/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const range = parseRange((request.query as Record<string, unknown>).range);
    try {
      const stats = getUserStatistics(db, session.userId, range);
      reply.send(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load statistics';
      reply.status(500).send({ error: message });
    }
  });

  app.get('/api/statistics/overall', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!session.isAdmin) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const range = parseRange((request.query as Record<string, unknown>).range);
    try {
      const stats = getOverallStatistics(db, range);
      reply.send(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load statistics';
      reply.status(500).send({ error: message });
    }
  });

  app.get('/api/statistics/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!session.isAdmin) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const range = parseRange((request.query as Record<string, unknown>).range);
    try {
      const stats = getUserStatistics(db, id, range);
      reply.send(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load statistics';
      reply.status(500).send({ error: message });
    }
  });

  app.get('/api/statistics/me/monthly-grouped', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const range = parseRange((request.query as Record<string, unknown>).range);
    try {
      const groupBy = groupBySchema.parse((request.query as Record<string, unknown>).groupBy);
      const data = getMonthlyGroupedPlays(db, session.userId, range, groupBy);
      reply.send({ data });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid query parameters' });
      }
      const message = err instanceof Error ? err.message : 'Failed to load statistics';
      reply.status(500).send({ error: message });
    }
  });

  app.get('/api/statistics/users/:id/monthly-grouped', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!session.isAdmin) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const range = parseRange((request.query as Record<string, unknown>).range);
    try {
      const groupBy = groupBySchema.parse((request.query as Record<string, unknown>).groupBy);
      const data = getMonthlyGroupedPlays(db, id, range, groupBy);
      reply.send({ data });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid query parameters' });
      }
      const message = err instanceof Error ? err.message : 'Failed to load statistics';
      reply.status(500).send({ error: message });
    }
  });
}
