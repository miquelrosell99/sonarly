import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import type { Config } from './config.js';
import { getDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { startLibraryWatcher, startIngestWatcher } from './scanner/watcher.js';
import { pushJob } from './scanner/queue.js';
import { registerOpenSubsonicRoutes } from './opensubsonic/routes/system.js';
import { registerManagementRoutes } from './management/scan.js';
import { createSessionStore } from './auth/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp(config: Config) {
  const db = getDb(config);
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
  await registerManagementRoutes(app, config, db);

  app.addHook('onClose', async () => {
    worker.postMessage({ type: 'shutdown' });
    await stopLibraryWatcher();
    await stopIngestWatcher();
  });

  return app;
}
