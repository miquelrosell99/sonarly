import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import fastifyStatic from '@fastify/static';
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
import { registerArtistManagementRoutes } from './management/artists.js';
import { registerAlbumManagementRoutes } from './management/albums.js';
import { registerPlaylistManagementRoutes } from './management/playlists.js';
import { registerScanManagementRoutes } from './management/scan.js';
import { registerIngestManagementRoutes } from './management/ingest.js';
import { registerOrganizeManagementRoutes } from './management/organize.js';
import { registerUserManagementRoutes } from './management/users.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveWorkerPath(): string {
  const candidates = [
    join(__dirname, 'scanner', 'worker.js'),
    join(__dirname, '..', 'dist', 'scanner', 'worker.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Scanner worker not found. Run `pnpm build` first.');
}

export async function buildApp(config: Config, providedDb?: Database.Database) {
  const db = providedDb ?? getDb(config);
  migrate(db);

  const worker = new Worker(resolveWorkerPath(), { workerData: config });

  pushJob(db, 'scan', config.LIBRARY_PATH);

  const stopLibraryWatcher = startLibraryWatcher(config, db);
  const stopIngestWatcher = startIngestWatcher(config, db);

  const app = Fastify({ logger: true });
  (app as any).worker = worker;

  await app.register(cookie);
  await app.register(session, {
    secret: config.SESSION_SECRET,
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

  registerAuthManagementRoutes(app, db, config.SESSION_SECRET);
  registerSongManagementRoutes(app, db);
  registerArtistManagementRoutes(app, db);
  registerAlbumManagementRoutes(app, db);
  registerPlaylistManagementRoutes(app, db);
  registerScanManagementRoutes(app, config, db);
  registerIngestManagementRoutes(app, db);
  registerOrganizeManagementRoutes(app, config, db);
  registerUserManagementRoutes(app, db, config.SESSION_SECRET);

  if (config.NODE_ENV === 'production') {
    const webDist = join(__dirname, '..', 'web-dist');
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET') {
        const accept = Array.isArray(request.headers.accept)
          ? request.headers.accept.join(',')
          : (request.headers.accept ?? '');
        if (accept.includes('text/html')) {
          return reply.sendFile('index.html');
        }
      }
      return reply.status(404).send({ error: 'Not Found' });
    });
  }

  app.addHook('onClose', async () => {
    worker.postMessage({ type: 'shutdown' });
    let timeout: ReturnType<typeof setTimeout>;
    await Promise.race([
      new Promise<void>((resolve) => worker.once('exit', () => { clearTimeout(timeout); resolve(); })),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 3000); }),
    ]);
    if (worker.threadId !== -1) {
      await worker.terminate();
    }
    await stopLibraryWatcher();
    await stopIngestWatcher();
    closeDb();
  });

  return app;
}
