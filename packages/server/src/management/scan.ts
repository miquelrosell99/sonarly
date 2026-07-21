import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { Config } from '../config.js';
import { pushJob } from '../scanner/queue.js';
import { getLatestScanJob } from '../db/repositories/scan-repository.js';

export function registerScanManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.post('/api/scans', (request: FastifyRequest, reply: FastifyReply) => {
    pushJob(db, 'scan', config.LIBRARY_PATH);
    reply.send({ ok: true });
  });

  app.get('/api/scans/status', (request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ job: getLatestScanJob(db) });
  });
}
