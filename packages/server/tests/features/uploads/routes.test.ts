import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import { createLibrary } from '../../../src/features/libraries/repository.js';
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

describe('upload routes', () => {
  let root: string;
  let config: Config;
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie: string;
  let libraryId: string;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-upload-${Date.now()}`);
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
      subsonicPasswordEncrypted: encryptSubsonicPassword('adminpass', config.SESSION_SECRET),
      isAdmin: true,
      createdAt: new Date().toISOString(),
    });
    libraryId = '550e8400-e29b-41d4-a716-446655440000';
    createLibrary(db, {
      id: libraryId,
      name: 'Music',
      path: config.LIBRARY_PATH,
      organizePattern: '{artist}/{title}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    app = await buildApp(config, db);

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'adminpass' },
    });
    adminCookie = login.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('creates an upload session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload/sessions',
      cookies: { sessionId: adminCookie },
      payload: { libraryId },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBeDefined();
    expect(body.libraryId).toBe(libraryId);
  });

  it('uploads a file in chunks and reassembles it', async () => {
    const session = await app.inject({
      method: 'POST',
      url: '/api/upload/sessions',
      cookies: { sessionId: adminCookie },
      payload: { libraryId },
    });
    const { sessionId } = JSON.parse(session.body);
    const content = Buffer.from('hello world audio content');

    const boundary = '----FormBoundary' + Date.now();
    const chunkBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="chunk.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const chunk = await app.inject({
      method: 'POST',
      url: `/api/upload/sessions/${sessionId}/files/file-1/chunks/0`,
      cookies: { sessionId: adminCookie },
      payload: chunkBody,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(chunk.statusCode).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/upload/sessions/${sessionId}/files/file-1/complete`,
      cookies: { sessionId: adminCookie },
      payload: { totalChunks: 1, relativePath: 'song.mp3' },
    });
    expect(complete.statusCode).toBe(200);

    const finish = await app.inject({
      method: 'POST',
      url: `/api/upload/sessions/${sessionId}/complete`,
      cookies: { sessionId: adminCookie },
    });
    expect(finish.statusCode).toBe(200);

    const ingestFile = join(config.INGEST_PATH, 'uploads', libraryId, 'song.mp3');
    expect(existsSync(ingestFile)).toBe(true);
    expect(readFileSync(ingestFile).toString()).toBe(content.toString());
  });

  it('forbids non-admins', async () => {
    createUser(db, {
      id: 'user-1',
      username: 'user',
      passwordHash: await hashPassword('userpass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('userpass', config.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'user', password: 'userpass' },
    });
    const userCookie = login.cookies.find((c) => c.name === 'sessionId')!.value;

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload/sessions',
      cookies: { sessionId: userCookie },
      payload: { libraryId },
    });
    expect(res.statusCode).toBe(403);
  });
});
