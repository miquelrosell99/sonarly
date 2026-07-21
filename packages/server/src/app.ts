import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import type { Config } from './config.js';
import type Database from 'better-sqlite3';
import { getDb, closeDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { startLibraryWatcher, startIngestWatcher } from './scanner/watcher.js';
import { pushJob } from './scanner/queue.js';
import { registerOpenSubsonicRoutes } from './opensubsonic/routes/system.js';
import { createSessionStore } from './auth/session.js';
import { registerAuthManagementRoutes } from './management/auth.js';
import { registerSongManagementRoutes } from './management/songs.js';
import { registerAlbumManagementRoutes } from './management/albums.js';
import { registerPlaylistManagementRoutes } from './management/playlists.js';
import { registerScanManagementRoutes } from './management/scan.js';
import { registerIngestManagementRoutes } from './management/ingest.js';
import { registerOrganizeManagementRoutes } from './management/organize.js';
import { registerUserManagementRoutes } from './management/users.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp(config: Config, providedDb?: Database.Database) {
  const db = providedDb ?? getDb(config);
  migrate(db);

  const worker = new Worker(join(__dirname, 'scanner', 'worker.js'), { workerData: config });

  pushJob(db, 'scan', config.LIBRARY_PATH);

  const stopLibraryWatcher = startLibraryWatcher(config, db);
  const stopIngestWatcher = startIngestWatcher(config, db);

  const app = Fastify({ logger: true });

  await app.register(cookie);
  await app.register(session, {
    secret: config.SESSION_SECRET || 'change-me-in-production',
    cookie: {
      httpOnly: true,
      secure: config.SESSION_COOKIE_SECURE,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
    store: createSessionStore(db),
  });

  await registerOpenSubsonicRoutes(app, config, db);

  app.addHook('preHandler', async (request, reply) => {
    const url = request.raw.url ?? '';
    if (!url.startsWith('/api/')) return;
    const exempt = ['/api/login', '/api/logout', '/api/setup', '/api/me'];
    if (exempt.some((p) => url === p || url.startsWith(`${p}?`))) return;

    if (request.method === 'GET' && request.routeOptions.url === '/api/playlists/:id') {
      const { shareToken } = request.query as { shareToken?: string };
      if (shareToken) return;
    }

    const session = (request as any).session as { userId?: string } | undefined;
    if (!session?.userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  registerAuthManagementRoutes(app, db);
  registerSongManagementRoutes(app, db);
  registerAlbumManagementRoutes(app, db);
  registerPlaylistManagementRoutes(app, db);
  registerScanManagementRoutes(app, config, db);
  registerIngestManagementRoutes(app, db);
  registerOrganizeManagementRoutes(app, config, db);
  registerUserManagementRoutes(app, db);

  app.addHook('onClose', async () => {
    worker.postMessage({ type: 'shutdown' });
    await stopLibraryWatcher();
    await stopIngestWatcher();
    closeDb();
  });

  return app;
}
