import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hashPassword, hashSubsonicPassword } from '../auth/password.js';
import { createUser } from '../db/repositories/user-repository.js';
import type { CreateUserInput } from '@sonarly/shared';

interface DbUserRow {
  id: string;
  username: string;
  is_admin: number;
  created_at: string;
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message.includes('UNIQUE constraint failed'));
}

export function registerUserManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post('/api/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!session?.isAdmin) return reply.status(403).send({ error: 'Forbidden' });

    const input = request.body as CreateUserInput;
    if (typeof input.username !== 'string' || input.username.length === 0) {
      return reply.status(400).send({ error: 'Username is required' });
    }
    if (typeof input.password !== 'string' || input.password.length === 0) {
      return reply.status(400).send({ error: 'Password is required' });
    }

    const passwordHash = await hashPassword(input.password);
    const subsonicPasswordHash = hashSubsonicPassword(input.password);
    try {
      createUser(db, {
        id: randomUUID(),
        username: input.username,
        isAdmin: input.isAdmin ?? false,
        passwordHash,
        subsonicPasswordHash,
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

  app.get('/api/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!session?.isAdmin) return reply.status(403).send({ error: 'Forbidden' });

    const rows = db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC').all() as DbUserRow[];
    reply.send({
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        isAdmin: Boolean(u.is_admin),
        createdAt: u.created_at,
      })),
    });
  });
}
