import type { FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { verifySubsonicToken } from '../auth/token.js';

export function registerOpenSubsonicAuth(app: any, db: Database.Database): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.routeOptions.url?.startsWith('/rest/')) return;

    const query = request.query as Record<string, string>;
    const { u, t, s, f } = query;
    const format = (f === 'xml' ? 'xml' : 'json') as 'json' | 'xml';
    (request as any).subsonicFormat = format;

    if (!u || !t || !s) {
      return reply.status(401).send({
        'subsonic-response': {
          status: 'failed',
          version: '1.16.1',
          error: { code: 10, message: 'Missing authentication' },
        },
      });
    }

    if (!verifySubsonicToken(db, u, t, s)) {
      return reply.status(401).send({
        'subsonic-response': {
          status: 'failed',
          version: '1.16.1',
          error: { code: 40, message: 'Wrong username or password' },
        },
      });
    }

    (request as any).subsonicUser = u;
  });
}
