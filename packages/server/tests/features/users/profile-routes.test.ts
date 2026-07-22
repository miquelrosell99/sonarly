import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser, updateProfile, updateAvatar } from '../../../src/features/users/repository.js';
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
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

async function seedUser(db: Database.Database, username: string, password: string) {
  const passwordHash = await hashPassword(password);
  const subsonicPasswordEncrypted = encryptSubsonicPassword(password, baseConfig.SESSION_SECRET);
  const id = `user-${username}`;
  createUser(db, {
    id,
    username,
    passwordHash,
    subsonicPasswordEncrypted,
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  return id;
}

function multipartBody(boundary: string, filename: string, contentType: string, buffer: Buffer): Buffer {
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf-8',
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  return Buffer.concat([prefix, buffer, suffix]);
}

// 1x1 transparent PNG
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('management profile endpoints', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-management-profile-${Date.now()}`);
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
    await seedUser(db, 'alice', 'alicepass');
    app = await buildApp(config, db);

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', password: 'alicepass' },
    });
    const sessionCookie = login.cookies.find((c) => c.name === 'sessionId');
    if (!sessionCookie) throw new Error('Login failed');
    cookie = sessionCookie.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns own profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user).toMatchObject({ id: 'user-alice', username: 'alice', isAdmin: false });
  });

  it('updates own profile', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      cookies: { sessionId: cookie },
      payload: { name: 'Alice', surname: 'Smith', email: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user).toMatchObject({
      id: 'user-alice',
      name: 'Alice',
      surname: 'Smith',
      email: 'alice@example.com',
    });
  });

  it('rejects profile updates when not authenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      payload: { name: 'Alice' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('uploads an avatar', async () => {
    const boundary = '----formdata-test';
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      cookies: { sessionId: cookie },
      payload: multipartBody(boundary, 'avatar.png', 'image/png', pngBytes),
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.avatarUrl).toMatch(/^\/api\/avatars\/user-alice/);

    const avatar = await app.inject({
      method: 'GET',
      url: body.user.avatarUrl,
    });
    expect(avatar.statusCode).toBe(200);
    expect(avatar.headers['content-type']).toBe('image/png');
  });

  it('rejects invalid avatar formats', async () => {
    const boundary = '----formdata-test';
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      cookies: { sessionId: cookie },
      payload: multipartBody(boundary, 'avatar.txt', 'text/plain', Buffer.from('not an image')),
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects avatar upload when not authenticated', async () => {
    const boundary = '----formdata-test';
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      payload: multipartBody(boundary, 'avatar.png', 'image/png', pngBytes),
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
