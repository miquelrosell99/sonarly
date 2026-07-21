import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerIngestManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/ingest', (request: FastifyRequest, reply: FastifyReply) => {
    const jobs = db.prepare('SELECT * FROM ingest_jobs ORDER BY created_at DESC LIMIT 100').all();
    reply.send({ jobs });
  });

  app.post('/api/ingest/trigger', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;
    db.prepare("INSERT INTO scan_jobs (id, type, status, stats) VALUES (?, 'ingest', 'pending', ?)")
      .run(randomUUID(), JSON.stringify({ path: '' }));
    reply.send({ ok: true });
  });
}
