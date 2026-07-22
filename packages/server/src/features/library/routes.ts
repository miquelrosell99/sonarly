import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { Config } from '../../config.js';
import { pushJob } from './queue.js';
import { getLatestScanJob } from './scan-repository.js';

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerScanManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.post('/api/scans', (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    pushJob(db, 'scan', config.LIBRARY_PATH);
    reply.send({ ok: true });
  });

  app.get('/api/scans/status', (request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ job: getLatestScanJob(db) });
  });
}
