import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, encryptSubsonicPassword } from '../auth/index.js';
import {
  createUser,
  listUsers,
  getUserById,
  updateUserTranscoding,
  updateUserContentFilters,
  updateUserAdminFields,
  deleteUserById,
} from '../users/index.js';
import { listInactiveSongs, deleteSongById, listCollisionSongs } from '../songs/index.js';
import { listInactiveAlbums, deleteAlbumById } from '../albums/index.js';
import { listInactiveArtists, deleteArtistById } from '../artists/index.js';
import { getSetting } from '../settings/index.js';
import { pushJob } from '../library/queue.js';
import type { CreateUserInput } from '@sonarly/shared';
import type { Config } from '../../config.js';

interface DbUserRow {
  id: string;
  username: string;
  is_admin: number;
  created_at: string;
  name: string | null;
  surname: string | null;
  email: string | null;
  avatar_path: string | null;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message.includes('UNIQUE constraint failed'))
  );
}

function buildAvatarUrl(userId: string): string {
  return `/api/avatars/${userId}`;
}

function requireAdmin(session: { userId: string; isAdmin: boolean } | undefined, reply: FastifyReply): boolean {
  if (!session?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
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
    {
      id: 'artist_images',
      name: 'Artist image sync',
      description: 'Fetches missing artist cover images from an external provider.',
      jobTypes: ['artist_images'],
      intervalMinutes: config.ARTIST_IMAGE_INTERVAL_MINUTES > 0 ? config.ARTIST_IMAGE_INTERVAL_MINUTES : null,
      getLastRunAt: (db) => {
        const status = getLatestJobStatus(db, ['artist_images']);
        return (status.lastRunAt ?? getSetting(db, 'last_artist_image_sync', '')) || null;
      },
      run: (db) => pushJob(db, 'artist_images', ''),
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
  taskId: z.enum(['periodic_scan', 'review_cleanup', 'artist_images']),
});

export function registerAdminRoutes(app: FastifyInstance, db: Database.Database, sessionSecret: string, config: Config): void {
  app.get('/api/admin/system-tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const tasks = getSystemTasks(config).map((def) => buildSystemTaskResponse(def, db));
    reply.send({ tasks });
  });

  app.post('/api/admin/system-tasks/:taskId/run', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

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

  app.get('/api/admin/system-tasks/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const query = request.query as { page?: string; limit?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(query.limit ?? '10', 10) || 10));
    const offset = (page - 1) * limit;

    const systemTaskTypes = ['scan', 'resync', 'cleanup_review', 'artist_images'];
    const placeholders = systemTaskTypes.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, type, status, started_at, finished_at, stats
       FROM scan_jobs
       WHERE type IN (${placeholders})
       ORDER BY started_at DESC, rowid DESC
       LIMIT ? OFFSET ?`
    ).all(...systemTaskTypes, limit, offset) as {
      id: string;
      type: string;
      status: string;
      started_at: string | null;
      finished_at: string | null;
      stats: string | null;
    }[];

    const totalRow = db.prepare(
      `SELECT COUNT(*) AS count FROM scan_jobs WHERE type IN (${placeholders})`
    ).get(...systemTaskTypes) as { count: number };
    const total = totalRow.count;

    const taskNameByType: Record<string, string> = {
      scan: 'Periodic library scan',
      resync: 'Periodic library scan',
      cleanup_review: 'Review folder cleanup',
      artist_images: 'Artist image sync',
    };

    reply.send({
      history: rows.map((row) => ({
        id: row.id,
        task: taskNameByType[row.type] ?? row.type,
        type: row.type,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        stats: row.stats ? JSON.parse(row.stats) : undefined,
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  });

  app.post('/api/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const input = request.body as CreateUserInput;
    if (typeof input.username !== 'string' || input.username.length === 0) {
      return reply.status(400).send({ error: 'Username is required' });
    }
    if (typeof input.password !== 'string' || input.password.length === 0) {
      return reply.status(400).send({ error: 'Password is required' });
    }

    const passwordHash = await hashPassword(input.password);
    const subsonicPasswordEncrypted = encryptSubsonicPassword(input.password, sessionSecret);
    try {
      createUser(db, {
        id: randomUUID(),
        username: input.username,
        isAdmin: input.isAdmin ?? false,
        passwordHash,
        subsonicPasswordEncrypted,
        createdAt: new Date().toISOString(),
        name: input.name ?? undefined,
        surname: input.surname ?? undefined,
        email: input.email ?? undefined,
        maxBitrateKbps: input.maxBitrateKbps,
        transcodeFormat: input.transcodeFormat,
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return reply.status(409).send({ error: 'Username already exists' });
      }
      throw err;
    }
    reply.status(201).send({ ok: true });
  });

  app.get('/api/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const users = listUsers(db).map((u) => ({
      ...u,
      avatarUrl: u.avatarUrl ? buildAvatarUrl(u.id) : undefined,
    }));
    reply.send({ users });
  });

  app.put('/api/admin/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    const existing = getUserById(db, id);
    if (!existing) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const body = request.body as {
      isAdmin?: boolean;
      name?: string | null;
      surname?: string | null;
      email?: string | null;
      password?: string | null;
      maxBitrateKbps?: number | null;
      transcodeFormat?: 'mp3' | 'aac' | 'opus' | null;
      hideExplicit?: boolean;
      blurExplicitTitles?: boolean;
      blurExplicitCovers?: boolean;
    };

    if (body.isAdmin === false && existing.isAdmin) {
      const adminCount = (db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get() as { count: number }).count;
      if (adminCount <= 1) {
        return reply.status(409).send({ error: 'Cannot remove the last admin' });
      }
    }

    const format = body.transcodeFormat;
    if (format !== undefined && format !== null && !['mp3', 'aac', 'opus'].includes(format)) {
      return reply.status(400).send({ error: 'Invalid transcode format' });
    }

    const bitrate = body.maxBitrateKbps;
    if (bitrate !== undefined && bitrate !== null && (!Number.isInteger(bitrate) || bitrate < 64 || bitrate > 320)) {
      return reply.status(400).send({ error: 'Invalid max bitrate' });
    }

    if (body.isAdmin !== undefined) {
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(body.isAdmin ? 1 : 0, id);
    }

    updateUserTranscoding(db, id, {
      maxBitrateKbps: bitrate === null ? undefined : bitrate,
      transcodeFormat: format === null ? undefined : format,
    });

    const hasContentFilterUpdate =
      body.hideExplicit !== undefined ||
      body.blurExplicitTitles !== undefined ||
      body.blurExplicitCovers !== undefined;
    if (hasContentFilterUpdate) {
      updateUserContentFilters(db, id, {
        hideExplicit: body.hideExplicit,
        blurExplicitTitles: body.blurExplicitTitles,
        blurExplicitCovers: body.blurExplicitCovers,
      });
    }

    const hasProfileUpdate =
      body.name !== undefined ||
      body.surname !== undefined ||
      body.email !== undefined ||
      body.password !== undefined;
    if (hasProfileUpdate) {
      const profileInput: Parameters<typeof updateUserAdminFields>[2] = {
        name: body.name,
        surname: body.surname,
        email: body.email,
      };
      if (body.password) {
        profileInput.passwordHash = await hashPassword(body.password);
        profileInput.subsonicPasswordEncrypted = encryptSubsonicPassword(body.password, sessionSecret);
      }
      updateUserAdminFields(db, id, profileInput);
    }

    reply.send({ ok: true });
  });

  app.delete('/api/admin/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    const existing = getUserById(db, id);
    if (!existing) {
      return reply.status(404).send({ error: 'User not found' });
    }

    if (session!.userId === id) {
      return reply.status(409).send({ error: 'Cannot delete your own account' });
    }

    if (existing.isAdmin) {
      const adminCount = (db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get() as { count: number }).count;
      if (adminCount <= 1) {
        return reply.status(409).send({ error: 'Cannot delete the last admin' });
      }
    }

    deleteUserById(db, id);
    reply.send({ ok: true });
  });

  app.get('/api/admin/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const usersCount = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
    const songsCount = (db.prepare('SELECT COUNT(*) AS count FROM songs').get() as { count: number }).count;
    const albumsCount = (db.prepare('SELECT COUNT(*) AS count FROM albums').get() as { count: number }).count;
    const artistsCount = (db.prepare('SELECT COUNT(*) AS count FROM artists').get() as { count: number }).count;
    const latestIngest = db
      .prepare("SELECT type, status, started_at, finished_at, stats FROM scan_jobs WHERE type = 'ingest' ORDER BY started_at DESC LIMIT 1")
      .get() as
      | { type: string; status: string; started_at: string; finished_at: string | null; stats: string | null }
      | undefined;

    const conflictsCount = listCollisionSongs(db).length;
    const missingSongsCount = (db.prepare('SELECT COUNT(*) AS count FROM songs WHERE active = 0').get() as { count: number }).count;
    const missingAlbumsCount = (db.prepare('SELECT COUNT(*) AS count FROM albums WHERE active = 0').get() as { count: number }).count;
    const missingArtistsCount = (db.prepare('SELECT COUNT(*) AS count FROM artists WHERE active = 0').get() as { count: number }).count;
    const ingestJobsCount = (db.prepare('SELECT COUNT(*) AS count FROM ingest_jobs').get() as { count: number }).count;

    reply.send({
      counts: { users: usersCount, songs: songsCount, albums: albumsCount, artists: artistsCount },
      conflictsCount,
      missingCounts: { songs: missingSongsCount, albums: missingAlbumsCount, artists: missingArtistsCount },
      ingestJobsCount,
      latestIngest: latestIngest
        ? {
            type: latestIngest.type,
            status: latestIngest.status,
            startedAt: latestIngest.started_at,
            finishedAt: latestIngest.finished_at,
            stats: latestIngest.stats ? JSON.parse(latestIngest.stats) : undefined,
          }
        : null,
    });
  });

  app.get('/api/admin/missing', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    reply.send({
      songs: listInactiveSongs(db),
      albums: listInactiveAlbums(db),
      artists: listInactiveArtists(db),
    });
  });

  app.delete('/api/admin/missing/songs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    deleteSongById(db, id);
    reply.send({ ok: true });
  });

  app.delete('/api/admin/missing/albums/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    deleteAlbumById(db, id);
    reply.send({ ok: true });
  });

  app.delete('/api/admin/missing/artists/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const { id } = request.params as { id: string };
    deleteArtistById(db, id);
    reply.send({ ok: true });
  });

  app.post('/api/admin/artists/refetch', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as { userId: string; isAdmin: boolean } | undefined;
    if (!requireAdmin(session, reply)) return;

    const jobId = pushJob(db, 'artist_images', JSON.stringify({ refetchExisting: true }));
    reply.status(202).send({ ok: true, jobId });
  });
}
