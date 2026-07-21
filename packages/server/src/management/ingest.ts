import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export function registerIngestManagementRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/ingest', (request: FastifyRequest, reply: FastifyReply) => {
    const jobs = db.prepare('SELECT * FROM ingest_jobs ORDER BY created_at DESC LIMIT 100').all();
    reply.send({ jobs });
  });

  app.post('/api/ingest/trigger', (request: FastifyRequest, reply: FastifyReply) => {
    db.prepare("INSERT INTO scan_jobs (id, type, status, stats) VALUES (?, 'ingest', 'pending', ?)")
      .run(randomUUID(), JSON.stringify({ path: '' }));
    reply.send({ ok: true });
  });
}
