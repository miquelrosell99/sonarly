import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { registerOrganizeManagementRoutes } from '../../../src/features/ingest/organize-routes.js';
import type { Config } from '../../../src/config.js';

const config: Config = {
  PORT: 3000,
  DATA_DIR: '/data',
  LIBRARY_PATH: '/data/library',
  INGEST_PATH: '/data/ingest',
  ORGANIZE_PATTERN: '{artist}/{album}/{title}',
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
  NODE_ENV: 'test',
  SESSION_SECRET: 'a'.repeat(32),
};

function buildApp(db: Database.Database) {
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    (request as any).session = { isAdmin: true };
  });
  registerOrganizeManagementRoutes(app, config, db);
  return app;
}

describe('organize management routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    app = buildApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('POST /api/organize returns stats synchronously', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/organize' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.stats).toEqual({ scanned: 0, moved: 0, skipped: 0, failed: 0 });
  });

  it('POST /api/organize/job returns a job id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/organize/job' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /api/organize/status/:jobId returns the job', async () => {
    const post = await app.inject({ method: 'POST', url: '/api/organize/job' });
    const { jobId } = JSON.parse(post.body);

    const res = await app.inject({ method: 'GET', url: `/api/organize/status/${jobId}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job.id).toBe(jobId);
    expect(body.job.type).toBe('organize');
  });

  it('GET /api/organize/status/:jobId returns 404 for unknown jobs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/organize/status/not-a-job' });
    expect(res.statusCode).toBe(404);
  });
});
