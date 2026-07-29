import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { LrcLibSearchResult } from '@sonarly/shared';
import { searchLrcLib } from './search.js';

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerLrcLibRoutes(app: FastifyInstance): void {
  app.get('/api/lrclib/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { title, artist, album, duration } = request.query as {
      title?: string;
      artist?: string;
      album?: string;
      duration?: string;
    };

    if (!title || title.trim().length === 0) {
      return reply.status(400).send({ error: 'title is required' });
    }

    const parsedDuration = duration && duration.trim().length > 0 ? Number(duration) : undefined;

    try {
      const matches = await searchLrcLib({
        title: title.trim(),
        artist: artist?.trim(),
        album: album?.trim(),
        duration: parsedDuration !== undefined && Number.isFinite(parsedDuration) ? parsedDuration : undefined,
      });
      return reply.send({ matches } satisfies LrcLibSearchResult);
    } catch (err) {
      request.log.error({ err }, 'LRCLIB search failed');
      return reply.status(502).send({
        error: err instanceof Error ? err.message : 'LRCLIB search failed',
      });
    }
  });
}
