import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import type { Config } from '../../../src/config.js';

vi.mock('node:worker_threads', () => {
  class MockWorker {
    postMessage = vi.fn();
    on = vi.fn();
    once = vi.fn((event: string, cb: () => void) => {
      if (event === 'exit') {
        this.threadId = -1;
        cb();
      }
    });
    terminate = vi.fn().mockResolvedValue(undefined);
    threadId = 1;
  }
  return {
    Worker: vi.fn().mockImplementation(() => new MockWorker()),
    workerData: {},
    parentPort: null,
  };
});

const baseConfig: Config = {
  PORT: 3000,
  NODE_ENV: 'test',
  SESSION_SECRET: 'a'.repeat(32),
  USE_CRYPTO: false,
  DATA_DIR: '/data',
  LIBRARY_PATH: '/data/library',
  INGEST_PATH: '/data/ingest',
  ORGANIZE_PATTERN: '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}',
  SCAN_INTERVAL_MINUTES: 60,
  REVIEW_RETENTION_DAYS: 30,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

async function loginAs(app: Awaited<ReturnType<typeof buildApp>>, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password },
  });
  return res.cookies.find((c) => c.name === 'sessionId')!.value;
}

describe('management settings endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-settings-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    config = {
      ...baseConfig,
      DATA_DIR: root,
      LIBRARY_PATH: join(root, 'library'),
      INGEST_PATH: join(root, 'ingest'),
    };
    mkdirSync(config.LIBRARY_PATH, { recursive: true });
    mkdirSync(config.INGEST_PATH, { recursive: true });

    db = new Database(join(root, 'sonarly.db'));
    migrate(db);
    createUser(db, {
      id: 'admin-1',
      username: 'admin',
      passwordHash: await hashPassword('adminpass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('adminpass', baseConfig.SESSION_SECRET),
      isAdmin: true,
      createdAt: new Date().toISOString(),
    });
    createUser(db, {
      id: 'user-1',
      username: 'regular',
      passwordHash: await hashPassword('regularpass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('regularpass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });

    app = await buildApp(config, db);
    adminCookie = await loginAs(app, 'admin', 'adminpass');
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns media settings for admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/media',
      cookies: { sessionId: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.organizePattern).toBe(config.ORGANIZE_PATTERN);
    expect(body.templates).toBeInstanceOf(Array);
    expect(body.templates.length).toBeGreaterThan(0);
  });

  it('updates the organize pattern', async () => {
    const newPattern = '{albumArtist}/{album}/{title}';
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/settings/media',
      cookies: { sessionId: adminCookie },
      payload: { organizePattern: newPattern },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).organizePattern).toBe(newPattern);

    const get = await app.inject({
      method: 'GET',
      url: '/api/settings/media',
      cookies: { sessionId: adminCookie },
    });
    expect(JSON.parse(get.body).organizePattern).toBe(newPattern);
  });

  it('rejects absolute patterns', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/media',
      cookies: { sessionId: adminCookie },
      payload: { organizePattern: '/{artist}/{title}' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('relative');
  });

  it('forbids non-admins', async () => {
    const regularCookie = await loginAs(app, 'regular', 'regularpass');
    const get = await app.inject({
      method: 'GET',
      url: '/api/settings/media',
      cookies: { sessionId: regularCookie },
    });
    expect(get.statusCode).toBe(403);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/settings/media',
      cookies: { sessionId: regularCookie },
      payload: { organizePattern: '{artist}/{title}' },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/media' });
    expect(res.statusCode).toBe(401);
  });

  it('reflects persisted pattern in organize preview', async () => {
    const newPattern = '{artist}/{title}';
    await app.inject({
      method: 'PATCH',
      url: '/api/settings/media',
      cookies: { sessionId: adminCookie },
      payload: { organizePattern: newPattern },
    });

    const preview = await app.inject({
      method: 'GET',
      url: '/api/organize/preview',
      cookies: { sessionId: adminCookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(JSON.parse(preview.body).pattern).toBe(newPattern);
  });
});
