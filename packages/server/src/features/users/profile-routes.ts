import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, createReadStream, createWriteStream, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import mime from 'mime-types';
import type { Config } from '../../config.js';
import { getUserById, updateProfile, updateAvatar } from '../users/index.js';
import type { UpdateProfileInput } from '@sonarly/shared';

const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function getAvatarsDir(config: Config): string {
  return join(config.DATA_DIR, 'avatars');
}

function buildAvatarUrl(userId: string): string {
  return `/api/avatars/${userId}`;
}

function sanitizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!trimmed.includes('@')) return trimmed;
  return trimmed;
}

function sanitizeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function serializeUser(user: ReturnType<typeof getUserById>, config: Config) {
  if (!user) return null;
  const avatarUrl = user.avatarUrl ? buildAvatarUrl(user.id) : undefined;
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
    name: user.name,
    surname: user.surname,
    email: user.email,
    avatarUrl,
  };
}

export function registerProfileManagementRoutes(app: FastifyInstance, db: Database.Database, config: Config): void {
  const avatarsDir = getAvatarsDir(config);
  if (!existsSync(avatarsDir)) {
    mkdirSync(avatarsDir, { recursive: true });
  }

  app.patch('/api/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const body = request.body as Record<string, unknown>;
    const input: UpdateProfileInput = {
      name: sanitizeName(body.name),
      surname: sanitizeName(body.surname),
      email: sanitizeEmail(body.email),
    };

    updateProfile(db, session.userId, input);
    const user = getUserById(db, session.userId);
    reply.send({ user: serializeUser(user, config) });
  });

  app.post('/api/me/avatar', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!session?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    if (!ALLOWED_AVATAR_TYPES.has(data.mimetype)) {
      await data.toBuffer().catch(() => undefined);
      return reply.status(400).send({ error: 'Invalid image format' });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > MAX_AVATAR_BYTES) {
      return reply.status(400).send({ error: 'Avatar must be smaller than 2 MB' });
    }

    const existing = getUserById(db, session.userId);
    const oldAvatarPath = existing?.avatarUrl ? join(avatarsDir, existing.avatarUrl) : undefined;

    const ext = mime.extension(data.mimetype) || extname(data.filename).slice(1) || 'png';
    const filename = `${session.userId}.${ext}`;
    const filePath = join(avatarsDir, filename);

    await new Promise<void>((resolve, reject) => {
      const writeStream = createWriteStream(filePath);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      writeStream.end(buffer);
    });

    updateAvatar(db, session.userId, filename);

    if (oldAvatarPath && oldAvatarPath !== filePath && existsSync(oldAvatarPath)) {
      try {
        unlinkSync(oldAvatarPath);
      } catch {
        // ignore cleanup errors
      }
    }

    const user = getUserById(db, session.userId);
    reply.send({ user: serializeUser(user, config) });
  });

  app.get('/api/avatars/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const user = getUserById(db, userId);
    if (!user?.avatarUrl) return reply.status(404).send({ error: 'Not found' });

    const filePath = join(avatarsDir, user.avatarUrl);
    if (!existsSync(filePath)) return reply.status(404).send({ error: 'Not found' });

    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(filePath));
  });
}
