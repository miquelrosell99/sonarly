import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { getDefaultLibrary, getLibraryById } from '../libraries/index.js';
import { pushJob } from '../library/queue.js';

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

const triggerSchema = z.object({
  libraryId: z.string().uuid().optional(),
});

export function registerIngestManagementRoutes(
  app: FastifyInstance,
  db: Database.Database,
  config: Config,
): void {
  app.get('/api/ingest', (request: FastifyRequest, reply: FastifyReply) => {
    const jobs = db.prepare('SELECT * FROM ingest_jobs ORDER BY created_at DESC LIMIT 100').all();
    reply.send({ jobs });
  });

  app.get('/api/ingest/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const job = db
      .prepare('SELECT * FROM ingest_jobs WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!job) {
      return reply.status(404).send({ error: 'Ingest job not found' });
    }
    reply.send({
      job: {
        id: String(job.id),
        sourcePath: String(job.source_path),
        targetPath: job.target_path ? String(job.target_path) : null,
        status: String(job.status),
        error: job.error ? String(job.error) : null,
        duplicate: Boolean(job.duplicate),
        duplicateStrategy: job.duplicate_strategy ? String(job.duplicate_strategy) : null,
        createdAt: String(job.created_at),
        updatedAt: String(job.updated_at),
      },
    });
  });

  app.delete('/api/ingest/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { id } = request.params as { id: string };
    const result = db.prepare('DELETE FROM ingest_jobs WHERE id = ?').run(id);
    if (result.changes === 0) {
      return reply.status(404).send({ error: 'Ingest job not found' });
    }
    reply.send({ ok: true });
  });

  app.delete('/api/ingest', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    db.prepare('DELETE FROM ingest_jobs').run();
    reply.send({ ok: true });
  });

  app.post('/api/ingest/trigger', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const parseResult = triggerSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    const library = parseResult.data.libraryId
      ? getLibraryById(db, parseResult.data.libraryId)
      : getDefaultLibrary(db);
    if (!library) {
      return reply.status(404).send({ error: 'Library not found' });
    }

    const sourcePath = join(config.INGEST_PATH, library.id);
    await mkdir(sourcePath, { recursive: true });

    pushJob(db, 'ingest', JSON.stringify({ sourcePath, libraryId: library.id }));
    reply.send({ ok: true });
  });
}
