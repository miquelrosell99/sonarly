import { FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { verifyPassword } from '../auth/password.js';
import { getUserByUsername } from '../db/repositories/user-repository.js';
import type { SessionData } from '../auth/session.js';

export async function loginUser(db: Database.Database, username: string, password: string): Promise<string | null> {
  const user = getUserByUsername(db, username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return user.id;
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): SessionData {
  const session = (request as any).session as { userId: string; username: string; isAdmin: boolean } | undefined;
  if (!session?.userId) {
    reply.status(401).send({ error: 'Unauthorized' });
    throw new Error('Unauthorized');
  }
  return session;
}
