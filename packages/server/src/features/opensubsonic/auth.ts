import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { verifySubsonicToken } from '../auth/index.js';
import { verifyApiKey } from '../auth/index.js';
import { verifyPassword } from '../auth/index.js';
import { getUserById, getUserByUsername } from '../users/index.js';
import { sendSubsonicReply } from './responses.js';

function decodeLegacyPassword(p: string): string {
  if (p.startsWith('enc:')) {
    return Buffer.from(p.slice(4), 'hex').toString('utf8');
  }
  return p;
}

export function registerOpenSubsonicAuth(app: FastifyInstance, db: Database.Database, sessionSecret: string): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.routeOptions.url?.startsWith('/rest/')) return;

    const query = request.query as Record<string, string>;
    const { u, t, s, p, f } = query;
    const format = (f === 'xml' ? 'xml' : 'json') as 'json' | 'xml';
    (request as any).subsonicFormat = format;

    if (request.routeOptions.url === '/rest/getPlaylist.view' && query.shareToken) {
      (request as any).subsonicUser = undefined;
      return;
    }

    const apiKey = query.apiKey ?? (request.headers['x-api-key'] as string | undefined);
    if (apiKey) {
      const userId = verifyApiKey(db, apiKey);
      if (!userId) {
        return sendSubsonicReply(reply, format, {
          error: { code: 40, message: 'Wrong username or password' },
        }, 'failed');
      }
      const user = getUserById(db, userId);
      if (!user) {
        return sendSubsonicReply(reply, format, {
          error: { code: 40, message: 'Wrong username or password' },
        }, 'failed');
      }
      (request as any).subsonicUser = user.id;
      return;
    }

    if (u && t && s) {
      const userId = verifySubsonicToken(db, u, t, s, sessionSecret);
      if (userId) {
        (request as any).subsonicUser = userId;
        return;
      }
    }

    if (u && p) {
      const user = getUserByUsername(db, u);
      if (user) {
        const password = decodeLegacyPassword(p);
        const ok = await verifyPassword(password, user.passwordHash);
        if (ok) {
          (request as any).subsonicUser = user.id;
          return;
        }
      }
    }

    const session = (request as any).session as { userId?: string } | undefined;
    if (session?.userId) {
      (request as any).subsonicUser = session.userId;
      return;
    }

    const missingAuth = (!u || (!t && !p) || (t && !s));
    return sendSubsonicReply(reply, format, {
      error: { code: missingAuth ? 10 : 40, message: missingAuth ? 'Missing authentication' : 'Wrong username or password' },
    }, 'failed');
  });
}
