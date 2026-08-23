import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hashPassword, encryptSubsonicPassword, verifyPassword } from '../auth/index.js';
import { getUserById, getUserByUsername, createUser } from '../users/index.js';
import type { SessionData } from '../auth/index.js';

function buildAvatarUrl(userId: string): string {
  return `/api/avatars/${userId}`;
}

function sanitizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function serializeUser(user: ReturnType<typeof getUserById>) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
    name: user.name,
    surname: user.surname,
    email: user.email,
    avatarUrl: user.avatarUrl ? buildAvatarUrl(user.id) : undefined,
    hideExplicit: user.hideExplicit,
    blurExplicitTitles: user.blurExplicitTitles,
    blurExplicitCovers: user.blurExplicitCovers,
  };
}

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

const MIN_PASSWORD_LENGTH = 8;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

interface LoginThrottle {
  failures: number;
  lockedUntil: number;
}

export function registerAuthManagementRoutes(app: FastifyInstance, db: Database.Database, sessionSecret: string): void {
  // Lightweight in-memory brute-force protection, keyed per IP + username.
  const loginAttempts = new Map<string, LoginThrottle>();

  app.post('/api/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = request.body as { username: string; password: string };
    const key = `${request.ip}:${String(username ?? '').toLowerCase()}`;
    const throttle = loginAttempts.get(key);
    if (throttle && throttle.lockedUntil > Date.now()) {
      return reply.status(429).send({ error: 'Too many failed login attempts. Try again later.' });
    }

    const userId = await loginUser(db, username, password);
    if (!userId) {
      const current = loginAttempts.get(key) ?? { failures: 0, lockedUntil: 0 };
      current.failures += 1;
      if (current.failures >= MAX_LOGIN_FAILURES) {
        current.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
        current.failures = 0;
      }
      loginAttempts.set(key, current);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    loginAttempts.delete(key);

    const user = getUserById(db, userId);
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });

    // Regenerate the session to close the session-fixation window.
    await (request as any).session.regenerate();
    const session = (request as any).session;
    session.userId = user.id;
    session.username = user.username;
    session.isAdmin = user.isAdmin;
    await session.save();

    reply.send({ user: serializeUser(user) });
  });

  app.post('/api/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    await (request as any).session.destroy();
    reply.send({ ok: true });
  });

  app.get('/api/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as SessionData | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });
    const user = getUserById(db, session.userId);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    reply.send({ user: serializeUser(user) });
  });

  app.get('/api/setup', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ needsSetup: userCount(db) === 0 });
  });

  app.post('/api/setup', async (request: FastifyRequest, reply: FastifyReply) => {
    if (userCount(db) > 0) {
      return reply.status(403).send({ error: 'Setup already completed' });
    }

    const body = request.body as Record<string, unknown>;
    const username = String(body.username ?? '');
    const password = String(body.password ?? '');
    const name = sanitizeOptionalString(body.name);
    const surname = sanitizeOptionalString(body.surname);
    const email = sanitizeOptionalString(body.email);

    if (username.length === 0) return reply.status(400).send({ error: 'Username is required' });
    if (password.length === 0) return reply.status(400).send({ error: 'Password is required' });
    if (password.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const passwordHash = await hashPassword(password);
    const subsonicPasswordEncrypted = encryptSubsonicPassword(password, sessionSecret);
    const id = randomUUID();
    const now = new Date().toISOString();
    createUser(db, { id, username, passwordHash, subsonicPasswordEncrypted, isAdmin: true, createdAt: now, name, surname, email });

    // Regenerate the session to close the session-fixation window.
    await (request as any).session.regenerate();
    const session = (request as any).session;
    session.userId = id;
    session.username = username;
    session.isAdmin = true;
    await session.save();

    const user = getUserById(db, id);
    reply.status(201).send({ user: serializeUser(user) });
  });
}
