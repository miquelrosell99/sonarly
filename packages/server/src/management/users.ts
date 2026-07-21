import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth/password.js';
import { createUser } from '../db/repositories/user-repository.js';
import type { CreateUserInput } from '@sonarly/shared';

interface DbUserRow {
  id: string;
  username: string;
  is_admin: number;
  created_at: string;
}

export function registerUserManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post('/api/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!session?.isAdmin) return reply.status(403).send({ error: 'Forbidden' });

    const input = request.body as CreateUserInput;
    const passwordHash = await hashPassword(input.password);
    createUser(db, {
      id: randomUUID(),
      username: input.username,
      isAdmin: input.isAdmin ?? false,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
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
