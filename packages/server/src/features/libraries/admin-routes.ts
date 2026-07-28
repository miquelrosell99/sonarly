import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  listLibraries,
  getLibraryById,
  createLibrary,
  updateLibrary,
  deleteLibraryById,
  getDefaultOrganizePattern,
  getLibraryUsers,
  assignUsersToLibrary,
  removeUserFromLibrary,
} from './repository.js';
import type { CreateLibraryInput, UpdateLibraryInput } from '@sonarly/shared';

function requireAdmin(session: { userId: string; isAdmin: boolean } | undefined, reply: FastifyReply): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

const createSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  organizePattern: z.string().min(1).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  organizePattern: z.string().min(1).optional(),
});

const assignUsersSchema = z.object({
  userIds: z.array(z.string().min(1)),
});

export function registerLibraryAdminRoutes(
  app: FastifyInstance,
  db: Database.Database,
  restartWatcher?: () => void,
): void {
  app.get('/api/libraries', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ libraries: listLibraries(db) });
  });

  app.get('/api/admin/libraries', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;
    reply.send({ libraries: listLibraries(db) });
  });

  app.post('/api/admin/libraries', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const parseResult = createSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }
    const input = parseResult.data as CreateLibraryInput;
    const now = new Date().toISOString();
    try {
      createLibrary(db, {
        id: randomUUID(),
        name: input.name,
        path: input.path,
        organizePattern: input.organizePattern ?? getDefaultOrganizePattern(db),
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return reply.status(409).send({ error: 'Library path already exists' });
      }
      throw err;
    }
    restartWatcher?.();
    reply.status(201).send({ ok: true });
  });

  app.put('/api/admin/libraries/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    const existing = getLibraryById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Library not found' });

    const parseResult = updateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }
    const input = parseResult.data as UpdateLibraryInput;
    try {
      updateLibrary(db, id, input);
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return reply.status(409).send({ error: 'Library path already exists' });
      }
      throw err;
    }
    restartWatcher?.();
    reply.send({ ok: true });
  });

  app.delete('/api/admin/libraries/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    const existing = getLibraryById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Library not found' });

    deleteLibraryById(db, id);
    restartWatcher?.();
    reply.send({ ok: true });
  });

  app.get('/api/admin/libraries/:id/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    const existing = getLibraryById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Library not found' });

    reply.send({ users: getLibraryUsers(db, id) });
  });

  app.post('/api/admin/libraries/:id/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    const existing = getLibraryById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Library not found' });

    const parseResult = assignUsersSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    assignUsersToLibrary(db, id, parseResult.data.userIds);
    reply.send({ ok: true });
  });

  app.delete('/api/admin/libraries/:id/users/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id, userId } = request.params as { id: string; userId: string };
    const existing = getLibraryById(db, id);
    if (!existing) return reply.status(404).send({ error: 'Library not found' });

    removeUserFromLibrary(db, id, userId);
    reply.send({ ok: true });
  });
}
