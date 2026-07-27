import { Worker, type WorkerOptions } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import type { Config, WorkerConfig } from './config.js';
import type Database from 'better-sqlite3';
import { getDb, closeDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import {
  startLibraryWatcher,
  startIngestWatcher,
  pushJob,
} from './features/library/index.js';
import { ensureDefaultLibrary, registerLibraryAdminRoutes } from './features/libraries/index.js';
import { registerOpenSubsonicRoutes } from './features/opensubsonic/index.js';
import { createSessionStore } from './features/auth/index.js';
import {
  registerAuthManagementRoutes,
  registerProfileManagementRoutes,
  registerAdminRoutes,
} from './features/users/index.js';
import { registerSongManagementRoutes, registerLyricsRoutes } from './features/songs/index.js';
import { registerArtistManagementRoutes } from './features/artists/index.js';
import { registerAlbumManagementRoutes } from './features/albums/index.js';
import { registerPlaylistManagementRoutes } from './features/playlists/index.js';
import { registerScanManagementRoutes } from './features/library/index.js';
import {
  registerIngestManagementRoutes,
  registerOrganizeManagementRoutes,
} from './features/ingest/index.js';
import { registerUploadRoutes } from './features/uploads/index.js';
import { registerSettingsManagementRoutes } from './features/settings/index.js';
import { registerConflictManagementRoutes } from './features/conflicts/index.js';
import { registerSuggestionRoutes } from './features/suggestions/index.js';
import { registerUserPreferenceRoutes } from './features/user-preferences/index.js';
import { registerFavoritesRoutes } from './features/favorites/index.js';
import { registerSearchRoutes } from './features/search/index.js';
import { registerPlayersRoutes } from './features/players/index.js';
import { registerHomeRoutes } from './features/home/index.js';
import { registerYearRoutes } from './features/years/index.js';
import { registerGenreManagementRoutes } from './features/genres/index.js';
import { registerStatisticsRoutes } from './features/statistics/index.js';
import { registerAutoDjRoutes } from './features/auto-dj/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isTsxRuntime(): boolean {
  return process.execArgv.some((arg) => /tsx[\\/]dist[\\/]loader\.mjs$/.test(arg));
}

function resolveWorkerPath(): string {
  const candidates = [
    ...(isTsxRuntime() ? [join(__dirname, 'features', 'library', 'worker.ts')] : []),
    join(__dirname, 'features', 'library', 'worker.js'),
    join(__dirname, '..', 'dist', 'features', 'library', 'worker.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Scanner worker not found. Run `pnpm build` first.');
}

function createTsxWorkerScript(workerPath: string): string {
  return `
    import { register } from 'tsx/esm/api';
    await register();
    await import(${JSON.stringify(workerPath)});
  `;
}

export async function buildApp(config: Config, providedDb?: Database.Database) {
  const db = providedDb ?? getDb(config);
  migrate(db);
  ensureDefaultLibrary(db, config.LIBRARY_PATH);

  const workerConfig: WorkerConfig = {
    DATA_DIR: config.DATA_DIR,
    LIBRARY_PATH: config.LIBRARY_PATH,
    INGEST_PATH: config.INGEST_PATH,
    ORGANIZE_PATTERN: config.ORGANIZE_PATTERN,
    SCAN_INTERVAL_MINUTES: config.SCAN_INTERVAL_MINUTES,
    ARTIST_IMAGE_INTERVAL_MINUTES: config.ARTIST_IMAGE_INTERVAL_MINUTES,
    REVIEW_RETENTION_DAYS: config.REVIEW_RETENTION_DAYS,
    WATCHER_USE_POLLING: config.WATCHER_USE_POLLING,
    PUID: config.PUID,
    PGID: config.PGID,
  };
  const workerPath = resolveWorkerPath();
  const worker = isTsxRuntime() && workerPath.endsWith('.ts')
    ? new Worker(createTsxWorkerScript(workerPath), { eval: true, workerData: workerConfig })
    : new Worker(workerPath, { workerData: workerConfig });

  pushJob(db, 'scan', '');
  if (config.ARTIST_IMAGE_INTERVAL_MINUTES > 0) {
    pushJob(db, 'artist_images', '');
  }

  const libraryWatcher = startLibraryWatcher(config, db);
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
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  await registerOpenSubsonicRoutes(app, config, db);

  app.addHook('preHandler', async (request, reply) => {
    const url = request.raw.url ?? '';
    if (!url.startsWith('/api/')) return;
    const exempt = ['/api/login', '/api/logout', '/api/setup', '/api/me', '/api/avatars', '/api/libraries'];
    if (exempt.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`))) return;

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
  registerProfileManagementRoutes(app, db, config);
  registerSongManagementRoutes(app, config, db);
  registerLyricsRoutes(app, config, db);
  registerArtistManagementRoutes(app, db);
  registerAlbumManagementRoutes(app, config, db);
  registerPlaylistManagementRoutes(app, db);
  registerScanManagementRoutes(app, config, db);
  registerIngestManagementRoutes(app, db);
  registerOrganizeManagementRoutes(app, config, db);
  registerUploadRoutes(app, config, db);
  registerAdminRoutes(app, db, config.SESSION_SECRET, config);
  registerLibraryAdminRoutes(app, db, () => { libraryWatcher.restart().catch((err) => console.error('Library watcher restart failed', err)); });
  registerSettingsManagementRoutes(app, config, db);
  registerConflictManagementRoutes(app, db);
  registerSuggestionRoutes(app, db);
  registerUserPreferenceRoutes(app, db);
  registerFavoritesRoutes(app, db);
  registerSearchRoutes(app, db);
  registerPlayersRoutes(app, db);
  registerHomeRoutes(app, db);
  registerYearRoutes(app, db);
  registerGenreManagementRoutes(app, db);
  registerStatisticsRoutes(app, db, config);
  registerAutoDjRoutes(app, db);

  const webDist = join(__dirname, '..', 'web-dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/rest/')) {
        return reply.sendFile('index.html');
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
    await libraryWatcher.stop();
    await stopIngestWatcher();
    closeDb();
  });

  return app;
}
