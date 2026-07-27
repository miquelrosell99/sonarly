import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { getCandidates } from './service.js';

const autoDjQuerySchema = z.object({
  currentSongId: z.string().optional(),
  mode: z.enum(['similar', 'random', 'smart']),
  count: z.coerce.number().int().min(1).max(50).default(10),
  excludeIds: z.string().default(''),
});

export function registerAutoDjRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/playback/auto-dj', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string } | undefined;
    if (!session?.userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const parsed = autoDjQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const { currentSongId, mode, count, excludeIds } = parsed.data;
    const exclude = excludeIds.split(',').filter(Boolean);

    try {
      const songs = getCandidates(db, session.userId, currentSongId, mode, count, exclude);
      reply.send({ songs });
    } catch (err) {
      request.log.error(err);
      reply.send({ songs: [] });
    }
  });
}
