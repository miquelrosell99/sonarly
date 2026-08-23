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
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

async function seedUser(db: Database.Database, username: string, email?: string) {
  createUser(db, {
    id: `user-${username}`,
    username,
    passwordHash: await hashPassword('pass'),
    subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
    isAdmin: false,
    createdAt: new Date().toISOString(),
    email,
  });
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password: 'pass' },
  });
  const sessionCookie = res.cookies.find((c) => c.name === 'sessionId');
  if (!sessionCookie) throw new Error('Login failed');
  return sessionCookie.value;
}

describe('user lookup endpoint', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-user-lookup-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    config = {
      ...baseConfig,
      DATA_DIR: root,
      LIBRARY_PATH: join(root, 'library'),
      INGEST_PATH: join(root, 'ingest'),
    };
    mkdirSync(config.LIBRARY_PATH, { recursive: true });
    mkdirSync(config.INGEST_PATH, { recursive: true });
    const db = new Database(join(root, 'sonarly.db'));
    migrate(db);
    await seedUser(db, 'alice');
    await seedUser(db, 'bob', 'bob@example.com');
    await seedUser(db, 'bobby');
    await seedUser(db, 'carol');
    app = await buildApp(config, db);
    cookie = await login(app, 'alice');
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users/lookup?q=bob' });
    expect(res.statusCode).toBe(401);
  });

  it('returns substring matches with only id and username', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/lookup?q=bob',
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(200);
    const { users } = JSON.parse(res.body);
    expect(users).toEqual([
      { id: 'user-bob', username: 'bob' },
      { id: 'user-bobby', username: 'bobby' },
    ]);
    expect(users[0]).not.toHaveProperty('email');
  });

  it('matches case-insensitively and excludes the requesting user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/lookup?q=ALI',
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).users).toEqual([]);
  });

  it('escapes LIKE wildcards in the query', async () => {
    const percent = await app.inject({
      method: 'GET',
      url: `/api/users/lookup?q=${encodeURIComponent('%')}`,
      cookies: { sessionId: cookie },
    });
    expect(percent.statusCode).toBe(200);
    expect(JSON.parse(percent.body).users).toEqual([]);

    const underscore = await app.inject({
      method: 'GET',
      url: `/api/users/lookup?q=${encodeURIComponent('b_b')}`,
      cookies: { sessionId: cookie },
    });
    expect(underscore.statusCode).toBe(200);
    expect(JSON.parse(underscore.body).users).toEqual([]);
  });

  it('returns at most 10 matches', async () => {
    const db = new Database(join(root, 'sonarly.db'));
    for (let i = 0; i < 12; i++) {
      await seedUser(db, `fan${String(i).padStart(2, '0')}`);
    }
    db.close();

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/lookup?q=fan',
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(200);
    const { users } = JSON.parse(res.body);
    expect(users).toHaveLength(10);
    expect(users.every((u: { username: string }) => u.username.startsWith('fan'))).toBe(true);
  });
});
