import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hashPassword, encryptSubsonicPassword } from '../auth/index.js';
import { createUser, listUsers, getUserById } from '../users/index.js';
import type { CreateUserInput } from '@sonarly/shared';

interface DbUserRow {
  id: string;
  username: string;
  is_admin: number;
  created_at: string;
  name: string | null;
  surname: string | null;
  email: string | null;
  avatar_path: string | null;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message.includes('UNIQUE constraint failed'))
  );
}

function buildAvatarUrl(userId: string): string {
  return `/api/avatars/${userId}`;
}

function requireAdmin(session: { userId: string; isAdmin: boolean } | undefined, reply: FastifyReply): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerAdminRoutes(app: FastifyInstance, db: Database.Database, sessionSecret: string): void {
  app.post('/api/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const input = request.body as CreateUserInput;
    if (typeof input.username !== 'string' || input.username.length === 0) {
      return reply.status(400).send({ error: 'Username is required' });
    }
    if (typeof input.password !== 'string' || input.password.length === 0) {
      return reply.status(400).send({ error: 'Password is required' });
    }

    const passwordHash = await hashPassword(input.password);
    const subsonicPasswordEncrypted = encryptSubsonicPassword(input.password, sessionSecret);
    try {
      createUser(db, {
        id: randomUUID(),
        username: input.username,
        isAdmin: input.isAdmin ?? false,
        passwordHash,
        subsonicPasswordEncrypted,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return reply.status(409).send({ error: 'Username already exists' });
      }
      throw err;
    }
    reply.status(201).send({ ok: true });
  });

  app.get('/api/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const users = listUsers(db).map((u) => ({
      ...u,
      avatarUrl: u.avatarUrl ? buildAvatarUrl(u.id) : undefined,
    }));
    reply.send({ users });
  });

  app.get('/api/admin/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const usersCount = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
    const songsCount = (db.prepare('SELECT COUNT(*) AS count FROM songs').get() as { count: number }).count;
    const albumsCount = (db.prepare('SELECT COUNT(*) AS count FROM albums').get() as { count: number }).count;
    const artistsCount = (db.prepare('SELECT COUNT(*) AS count FROM artists').get() as { count: number }).count;
    const latestScan = db
      .prepare('SELECT type, status, started_at, finished_at, stats FROM scan_jobs ORDER BY started_at DESC LIMIT 1')
      .get() as
      | { type: string; status: string; started_at: string; finished_at: string | null; stats: string | null }
      | undefined;

    reply.send({
      counts: { users: usersCount, songs: songsCount, albums: albumsCount, artists: artistsCount },
      latestScan: latestScan
        ? {
            type: latestScan.type,
            status: latestScan.status,
            startedAt: latestScan.started_at,
            finishedAt: latestScan.finished_at,
            stats: latestScan.stats ? JSON.parse(latestScan.stats) : undefined,
          }
        : null,
    });
  });
}
