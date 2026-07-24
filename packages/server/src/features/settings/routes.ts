import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { getSetting, setSetting, getOrganizePattern } from './repository.js';
import { pushJob } from '../library/queue.js';

const templates = [
  {
    label: 'Album Artist / (Year) Album / Disc Number Track Number - Title',
    value: '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}',
  },
  { label: 'Artist / Album / Track - Title', value: '{artist}/{album}/{track:00} - {title}' },
  { label: 'Artist / Album / Track - Title (no zero pad)', value: '{artist}/{album}/{track} - {title}' },
  { label: 'Album Artist / Album / Track - Title', value: '{albumArtist}/{album}/{track:00} - {title}' },
  { label: 'Artist / Year - Album / Track - Title', value: '{artist}/{year} - {album}/{track:00} - {title}' },
  { label: 'Artist / Title', value: '{artist}/{title}' },
];

const mediaPatchSchema = z.object({
  organizePattern: z.string().min(1),
});

function requireAdmin(reply: FastifyReply, session: { isAdmin?: boolean } | undefined): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function validatePattern(pattern: string): string | undefined {
  if (pattern.startsWith('/')) {
    return 'Pattern must be relative';
  }
  if (pattern.split('/').some((segment) => segment === '..' || segment.includes('\0'))) {
    return 'Pattern contains invalid path segments';
  }
  return undefined;
}

type SystemTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface SystemTask {
  id: string;
  name: string;
  description: string;
  intervalMinutes: number | null;
  lastRunAt: string | null;
  status: SystemTaskStatus | null;
}

interface SystemTaskDefinition {
  id: string;
  name: string;
  description: string;
  jobTypes: string[];
  intervalMinutes: number | null;
  getLastRunAt: (db: Database.Database) => string | null;
  run: (db: Database.Database, config: Config) => void;
}

function getLatestJobStatus(db: Database.Database, types: string[]): Pick<SystemTask, 'status' | 'lastRunAt'> {
  if (types.length === 0) return { status: null, lastRunAt: null };
  const placeholders = types.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT status, finished_at FROM scan_jobs WHERE type IN (${placeholders}) ORDER BY rowid DESC LIMIT 1`
  ).get(...types) as { status: SystemTaskStatus; finished_at: string | null } | undefined;
  if (!row) return { status: null, lastRunAt: null };
  return { status: row.status, lastRunAt: row.finished_at ?? null };
}

function getSystemTasks(config: Config): SystemTaskDefinition[] {
  return [
    {
      id: 'periodic_scan',
      name: 'Periodic library scan',
      description: 'Scans the library for new, changed, or removed audio files.',
      jobTypes: ['scan', 'resync'],
      intervalMinutes: config.SCAN_INTERVAL_MINUTES > 0 ? config.SCAN_INTERVAL_MINUTES : null,
      getLastRunAt: (db) => {
        const status = getLatestJobStatus(db, ['scan', 'resync']);
        return status.lastRunAt;
      },
      run: (db, cfg) => pushJob(db, 'scan', cfg.LIBRARY_PATH),
    },
    {
      id: 'review_cleanup',
      name: 'Review folder cleanup',
      description: 'Deletes files from the ingest review folder that are older than the retention period.',
      jobTypes: ['cleanup_review'],
      intervalMinutes: 24 * 60,
      getLastRunAt: (db) => {
        const status = getLatestJobStatus(db, ['cleanup_review']);
        return (status.lastRunAt ?? getSetting(db, 'last_review_cleanup', '')) || null;
      },
      run: (db) => pushJob(db, 'cleanup_review', ''),
    },
  ];
}

function buildSystemTaskResponse(def: SystemTaskDefinition, db: Database.Database): SystemTask {
  const status = getLatestJobStatus(db, def.jobTypes);
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    intervalMinutes: def.intervalMinutes,
    lastRunAt: status.lastRunAt ?? def.getLastRunAt(db),
    status: status.status,
  };
}

const taskRunParamsSchema = z.object({
  taskId: z.enum(['periodic_scan', 'review_cleanup']),
});

export function registerSettingsManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): void {
  app.get('/api/settings/media', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    reply.send({
      organizePattern: getOrganizePattern(db, config),
      templates,
    });
  });

  app.patch('/api/settings/media', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const parseResult = mediaPatchSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    const { organizePattern } = parseResult.data;
    const validationError = validatePattern(organizePattern);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    setSetting(db, 'organize_pattern', organizePattern);
    reply.send({ organizePattern });
  });

  app.get('/api/settings/system-tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const tasks = getSystemTasks(config).map((def) => buildSystemTaskResponse(def, db));
    reply.send({ tasks });
  });

  app.post('/api/settings/system-tasks/:taskId/run', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { isAdmin?: boolean } | undefined;
    if (!requireAdmin(reply, session)) return;

    const parseResult = taskRunParamsSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid task id' });
    }

    const { taskId } = parseResult.data;
    const task = getSystemTasks(config).find((t) => t.id === taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    task.run(db, config);
    reply.status(202).send({ ok: true });
  });
}
