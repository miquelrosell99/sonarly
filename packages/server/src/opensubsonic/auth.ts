import type { FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { verifySubsonicToken } from '../auth/token.js';
import { verifyApiKey } from '../auth/api-keys.js';
import { getUserById, getUserByUsername } from '../db/repositories/user-repository.js';
import { sendSubsonicReply } from './responses.js';

export function registerOpenSubsonicAuth(app: any, db: Database.Database): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.routeOptions.url?.startsWith('/rest/')) return;

    const query = request.query as Record<string, string>;
    const { u, t, s, f } = query;
    const format = (f === 'xml' ? 'xml' : 'json') as 'json' | 'xml';
    (request as any).subsonicFormat = format;

    const apiKey = query.apiKey ?? (request.headers['x-api-key'] as string | undefined);
    if (apiKey) {
      const userId = verifyApiKey(db, apiKey);
      if (!userId) {
        return sendSubsonicReply(reply.status(401), format, {
          error: { code: 40, message: 'Wrong username or password' },
        }, 'failed');
      }
      const user = getUserById(db, userId);
      if (!user) {
        return sendSubsonicReply(reply.status(401), format, {
          error: { code: 40, message: 'Wrong username or password' },
        }, 'failed');
      }
      (request as any).subsonicUser = user.id;
      return;
    }

    if (!u || !t || !s) {
      return sendSubsonicReply(reply.status(401), format, {
        error: { code: 10, message: 'Missing authentication' },
      }, 'failed');
    }

    if (!verifySubsonicToken(db, u, t, s)) {
      return sendSubsonicReply(reply.status(401), format, {
        error: { code: 40, message: 'Wrong username or password' },
      }, 'failed');
    }

    const user = getUserByUsername(db, u);
    if (!user) {
      return sendSubsonicReply(reply.status(401), format, {
        error: { code: 40, message: 'Wrong username or password' },
      }, 'failed');
    }

    (request as any).subsonicUser = user.id;
  });
}
