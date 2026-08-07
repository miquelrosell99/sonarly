import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { buildSubsonicToken } from '../../../src/features/auth/token.js';
import { clearActivePlayers, recordStream, getActivePlayers } from '../../../src/features/players/tracker.js';
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
  SESSION_SECRET: 'a-secret-key-that-is-long-enough-for-the-session-secret-32',
  USE_CRYPTO: false,
  DATA_DIR: '/data',
  LIBRARY_PATH: '/data/library',
  INGEST_PATH: '/data/ingest',
  ORGANIZE_PATTERN: '{artist}/{album}/{track:00} - {title}',
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: false,
  PUID: 1000,
  PGID: 1000,
};

describe('players endpoint', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookieValue: string;
  let db: Database.Database;
  const fixturePath = fileURLToPath(new URL('../../fixtures/sample.mp3', import.meta.url));

  beforeEach(async () => {
    clearActivePlayers();
    root = join(tmpdir(), `sonarly-players-${Date.now()}`);
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
      id: 'user-1',
      username: 'tester',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    copyFileSync(fixturePath, join(config.LIBRARY_PATH, 'song1.mp3'));
    upsertSong(db, {
      id: 'song-1',
      filePath: join(config.LIBRARY_PATH, 'song1.mp3'),
      title: 'Sample Song',
      duration: 1,
      mtime: Date.now(),
      checksum: 'c1',
    });

    app = await buildApp(config, db);
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'tester', password: 'pass' },
    });
    cookieValue = login.cookies.find((c) => c.name === 'sessionId')!.value;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/players' });
    expect(res.statusCode).toBe(401);
  });

  function streamUrl(): string {
    const salt = 'salty';
    const token = buildSubsonicToken('pass', salt);
    return `/rest/stream.view?id=song-1&u=tester&t=${token}&s=${salt}&f=json`;
  }

  it('lists active players after a stream', async () => {
    const stream = await app.inject({ method: 'GET', url: streamUrl() });
    expect(stream.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/players',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.players).toHaveLength(1);
    expect(body.players[0].userId).toBe('user-1');
    expect(body.players[0].songId).toBe('song-1');
    expect(body.players[0].songTitle).toBe('Sample Song');
  });

  it('records an anonymous stream using request.id when no user is present', () => {
    clearActivePlayers();
    const mockRequest = {
      id: 'anonymous-req-1',
      headers: {},
    } as unknown as Parameters<typeof recordStream>[1];

    recordStream(db, mockRequest, {
      id: 'song-1',
      filePath: join(config.LIBRARY_PATH, 'song1.mp3'),
      title: 'Sample Song',
      mtime: Date.now(),
      checksum: 'c1',
    });

    const players = getActivePlayers();
    expect(players).toHaveLength(1);
    expect(players[0].id).toBe('anonymous-req-1');
    expect(players[0].userId).toBeUndefined();
    expect(players[0].songId).toBe('song-1');
  });

  it('returns all active players', async () => {
    createUser(db, {
      id: 'user-2',
      username: 'other',
      passwordHash: await hashPassword('pass'),
      subsonicPasswordEncrypted: encryptSubsonicPassword('pass', baseConfig.SESSION_SECRET),
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'other', password: 'pass' },
    });
    const otherCookie = otherLogin.cookies.find((c) => c.name === 'sessionId')!.value;

    const otherSalt = 'other-salty';
    const otherToken = buildSubsonicToken('pass', otherSalt);
    await app.inject({
      method: 'GET',
      url: `/rest/stream.view?id=song-1&u=other&t=${otherToken}&s=${otherSalt}&f=json`,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/players',
      cookies: { sessionId: cookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.players).toHaveLength(1);
    expect(body.players[0].userId).toBe('user-2');

    const otherRes = await app.inject({
      method: 'GET',
      url: '/api/players',
      cookies: { sessionId: otherCookie },
    });
    expect(otherRes.statusCode).toBe(200);
    const otherBody = JSON.parse(otherRes.body);
    expect(otherBody.players).toHaveLength(1);
    expect(otherBody.players[0].userId).toBe('user-2');
  });
});
