import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { getLibraryById } from '../libraries/repository.js';
import { pushJob } from '../library/queue.js';
import { createUploadSession, getUploadSession, deleteUploadSession } from './repository.js';
import { writeChunk, reassembleFile, moveSessionFilesToIngest, removeSessionDirectory } from './chunked.js';

const sessionSchema = z.object({ libraryId: z.string().uuid() });
const completeFileSchema = z.object({ totalChunks: z.number().int().min(1), relativePath: z.string().min(1) });

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerUploadRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.post('/api/upload/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(reply, (request as any).session)) return;

    const parse = sessionSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: 'Invalid input' });

    const library = getLibraryById(db, parse.data.libraryId);
    if (!library) return reply.status(404).send({ error: 'Library not found' });

    const session = createUploadSession(db, library.id);
    reply.status(201).send({ sessionId: session.id, libraryId: session.libraryId });
  });

  app.post('/api/upload/sessions/:id/files/:fileId/chunks/:index', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(reply, (request as any).session)) return;

    const { id, fileId, index } = request.params as { id: string; fileId: string; index: string };
    const session = getUploadSession(db, id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'No file uploaded' });

    const buffer = await file.toBuffer();
    const sessionDir = join(config.DATA_DIR, 'uploads', id);
    await writeChunk(sessionDir, fileId, Number(index), buffer);
    reply.send({ ok: true });
  });

  app.post('/api/upload/sessions/:id/files/:fileId/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(reply, (request as any).session)) return;

    const { id, fileId } = request.params as { id: string; fileId: string };
    const session = getUploadSession(db, id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const parse = completeFileSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: 'Invalid input' });

    const sessionDir = join(config.DATA_DIR, 'uploads', id);
    await reassembleFile(sessionDir, fileId, parse.data.totalChunks, parse.data.relativePath);
    reply.send({ ok: true });
  });

  app.post('/api/upload/sessions/:id/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(reply, (request as any).session)) return;

    const { id } = request.params as { id: string };
    const session = getUploadSession(db, id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const library = getLibraryById(db, session.libraryId);
    if (!library) return reply.status(404).send({ error: 'Library not found' });

    const sessionDir = join(config.DATA_DIR, 'uploads', id);
    const ingestDir = join(config.INGEST_PATH, 'uploads', session.libraryId);
    await moveSessionFilesToIngest(sessionDir, ingestDir);
    pushJob(db, 'ingest', JSON.stringify({ sourcePath: ingestDir, libraryId: library.id }));
    deleteUploadSession(db, id);
    await removeSessionDirectory(sessionDir);
    reply.send({ ok: true });
  });
}
