import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { Config } from '../../config.js';
import { getOrganizePattern } from '../settings/index.js';
import { pushJob } from '../library/queue.js';
import { organizeExistingLibrary } from '../ingest/index.js';

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

interface OrganizeJobStatus {
  id: string;
  type: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  stats?: Record<string, unknown>;
}

interface ScanJobRow {
  id: string;
  type: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  stats: string | null;
}

function getOrganizeJob(db: Database.Database, id: string): OrganizeJobStatus | undefined {
  const row = db.prepare('SELECT id, type, status, started_at, finished_at, stats FROM scan_jobs WHERE id = ?').get(id) as ScanJobRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    stats: row.stats ? JSON.parse(row.stats) : undefined,
  };
}

export function registerOrganizeManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.post('/api/organize', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const stats = await organizeExistingLibrary(config, db);
    reply.send({ stats });
  });

  app.post('/api/organize/job', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const jobId = pushJob(db, 'organize', '');
    reply.send({ jobId });
  });

  app.get('/api/organize/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ pattern: getOrganizePattern(db, config) });
  });

  app.get('/api/organize/status/:jobId', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const { jobId } = request.params as { jobId: string };
    const job = getOrganizeJob(db, jobId);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }
    reply.send({ job });
  });
}
