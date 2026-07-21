import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hashPassword, hashSubsonicPassword, verifyPassword } from '../auth/password.js';
import { getUserById, getUserByUsername, createUser } from '../db/repositories/user-repository.js';
import type { SessionData } from '../auth/session.js';

export async function loginUser(db: Database.Database, username: string, password: string): Promise<string | null> {
  const user = getUserByUsername(db, username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return user.id;
}

function userCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}

export function registerAuthManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post('/api/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = request.body as { username: string; password: string };
    const userId = await loginUser(db, username, password);
    if (!userId) return reply.status(401).send({ error: 'Invalid credentials' });

    const user = getUserById(db, userId);
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });

    const session = (request as any).session;
    session.userId = user.id;
    session.username = user.username;
    session.isAdmin = user.isAdmin;
    await session.save();

    reply.send({ user: { id: user.id, username: user.username, isAdmin: user.isAdmin } });
  });

  app.post('/api/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    await (request as any).session.destroy();
    reply.send({ ok: true });
  });

  app.get('/api/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as SessionData | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });
    reply.send({ user: session });
  });

  app.get('/api/setup', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ needsSetup: userCount(db) === 0 });
  });

  app.post('/api/setup', async (request: FastifyRequest, reply: FastifyReply) => {
    if (userCount(db) > 0) {
      return reply.status(403).send({ error: 'Setup already completed' });
    }

    const { username, password } = request.body as { username: string; password: string };
    const passwordHash = await hashPassword(password);
    const subsonicPasswordHash = hashSubsonicPassword(password);
    const id = randomUUID();
    const now = new Date().toISOString();
    createUser(db, { id, username, passwordHash, subsonicPasswordHash, isAdmin: true, createdAt: now });

    const session = (request as any).session;
    session.userId = id;
    session.username = username;
    session.isAdmin = true;
    await session.save();

    reply.status(201).send({ user: { id, username, isAdmin: true } });
  });
}
