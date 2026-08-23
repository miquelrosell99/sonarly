import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { MAX_EXCLUDE_IDS, AUTO_DJ_EXCLUDE_WINDOWS } from '@sonarly/shared';
import type { AutoDjExcludeWindow } from '@sonarly/shared';
import { getCandidates } from './service.js';
import type { AutoDjMode, AutoDjOptions } from './service.js';
import { getUserPreferences } from '../user-preferences/repository.js';

const modeSchema = z.enum(['similar', 'random', 'smart']);

// Legacy GET variant: exclusions arrive as a comma-separated query string.
const autoDjQuerySchema = z.object({
  currentSongId: z.string().optional(),
  mode: modeSchema,
  count: z.coerce.number().int().min(1).max(50).default(10),
  excludeIds: z.string().default(''),
});

// POST variant: exclusions arrive in the body, avoiding multi-KB URLs.
const autoDjBodySchema = z.object({
  currentSongId: z.string().optional(),
  mode: modeSchema,
  count: z.number().int().min(1).max(50).default(10),
  excludeIds: z.array(z.string()).max(MAX_EXCLUDE_IDS).default([]),
});

interface AutoDjRequest {
  currentSongId?: string;
  mode: AutoDjMode;
  count: number;
  excludeIds: string[];
}

// DJ configuration (exclude window, favorites, discovery) lives in the stored
// user preferences so old clients that only send mode/count keep working.
function resolveAutoDjOptions(db: Database.Database, userId: string): AutoDjOptions {
  const prefs = getUserPreferences(db, userId);
  const window: AutoDjExcludeWindow = AUTO_DJ_EXCLUDE_WINDOWS.includes(
    prefs.autoDjExcludeWindow as AutoDjExcludeWindow,
  )
    ? (prefs.autoDjExcludeWindow as AutoDjExcludeWindow)
    : '24h';
  const rawDiscovery = Number(prefs.autoDjDiscovery ?? 50);
  const discovery = Number.isFinite(rawDiscovery)
    ? Math.min(100, Math.max(0, rawDiscovery))
    : 50;
  return {
    excludeWindow: window,
    preferFavorites: prefs.autoDjPreferFavorites === true,
    discovery,
  };
}

export function registerAutoDjRoutes(app: FastifyInstance, db: Database.Database): void {
  const handleAutoDj = async (
    request: FastifyRequest,
    reply: FastifyReply,
    parsed: AutoDjRequest,
  ) => {
    const session = (request as any).session as { userId: string } | undefined;
    if (!session?.userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const options = resolveAutoDjOptions(db, session.userId);

    try {
      const songs = getCandidates(
        db,
        session.userId,
        parsed.currentSongId,
        parsed.mode,
        parsed.count,
        parsed.excludeIds,
        options,
      );
      reply.send({ songs });
    } catch (err) {
      request.log.error(err);
      reply.send({ songs: [] });
    }
  };

  app.get('/api/playback/auto-dj', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = autoDjQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }
    const { currentSongId, mode, count, excludeIds } = parsed.data;
    return handleAutoDj(request, reply, {
      currentSongId,
      mode,
      count,
      excludeIds: excludeIds.split(',').filter(Boolean).slice(0, MAX_EXCLUDE_IDS),
    });
  });

  app.post('/api/playback/auto-dj', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = autoDjBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }
    return handleAutoDj(request, reply, parsed.data);
  });
}
