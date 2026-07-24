import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { getActivePlayers } from './tracker.js';

export function registerPlayersRoutes(app: FastifyInstance, _db: Database.Database): void {
  app.get('/api/players', (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).session?.userId as string | undefined;
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const players = getActivePlayers().filter((player) => player.userId === userId);
    reply.send({ players });
  });
}
