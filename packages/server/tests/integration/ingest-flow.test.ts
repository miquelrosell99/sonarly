import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { copyFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'node:worker_threads';
import {
  createTempConfig,
  createTestDatabase,
  seedUser,
  login,
  waitForJob,
  closeAppAndCleanup,
  buildTestApp,
} from './helpers.js';

const fixturePath = new URL('../fixtures/sample.mp3', import.meta.url).pathname;

async function waitForSongs(
  app: FastifyInstance,
  cookie: string,
  predicate: (songs: { title: string; artistName?: string; albumName?: string }[]) => boolean,
  timeoutMs = 10000,
  intervalMs = 100
): Promise<{ title: string; artistName?: string; albumName?: string }[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await app.inject({
      method: 'GET',
      url: '/api/songs',
      cookies: { sessionId: cookie },
    });
    if (res.statusCode === 200) {
      const songs = JSON.parse(res.body).songs;
      if (predicate(songs)) return songs;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timeout waiting for songs to appear');
}

describe('Ingest flow', () => {
  let root: string;
  let config: ReturnType<typeof createTempConfig>['config'];
  let db: Database.Database;
  let app: FastifyInstance & { worker?: Worker };
  let cookie: string;

  beforeAll(async () => {
    ({ root, config } = createTempConfig('sonarly-ingest-flow'));
    db = createTestDatabase(config);
    await seedUser(db, 'admin', 'adminpass');
    app = await buildTestApp(config, db);

    // Initial scan runs against the empty library.
    const scanJob = await waitForJob(db, 'scan');
    expect(scanJob.status).toBe('completed');

    cookie = await login(app, 'admin', 'adminpass');
  });

  afterAll(async () => {
    await closeAppAndCleanup(app, root);
  });

  it('imports the sample MP3 through the ingest endpoint and surfaces it via /api/songs', async () => {
    copyFileSync(fixturePath, `${config.INGEST_PATH}/sample.mp3`);

    const trigger = await app.inject({
      method: 'POST',
      url: '/api/ingest/trigger',
      cookies: { sessionId: cookie },
    });
    expect(trigger.statusCode).toBe(200);
    expect(JSON.parse(trigger.body)).toEqual({ ok: true });

    const ingestJob = await waitForJob(db, 'ingest');
    expect(ingestJob.status).toBe('completed');
    expect(ingestJob.stats?.imported).toBeGreaterThanOrEqual(1);

    const songs = await waitForSongs(app, cookie, (list) =>
      list.some((s) => s.title === 'Sample Song')
    );
    const song = songs.find((s) => s.title === 'Sample Song');
    expect(song).toBeDefined();
    expect(song!.artistName).toBe('Sample Artist');
    expect(song!.albumName).toBe('Sample Album');
  });
});
