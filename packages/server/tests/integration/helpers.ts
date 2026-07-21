import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../src/config.js';
import { buildApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrate.js';
import { hashPassword } from '../../src/auth/password.js';
import { createUser } from '../../src/db/repositories/user-repository.js';
import { buildSubsonicToken } from '../../src/auth/token.js';

export const baseConfig: Config = {
  PORT: 0,
  NODE_ENV: 'test',
  SESSION_SECRET: 'a-secret-key-that-is-long-enough-for-the-session-secret-32',
  SESSION_COOKIE_SECURE: false,
  USE_CRYPTO: false,
  DATA_DIR: '/data',
  LIBRARY_PATH: '/data/library',
  INGEST_PATH: '/data/ingest',
  ORGANIZE_PATTERN: '{artist}/{album}/{track:00} - {title}{ext}',
  SCAN_INTERVAL_MINUTES: 60,
  WATCHER_USE_POLLING: true,
  PUID: 1000,
  PGID: 1000,
};

export interface SeededUser {
  id: string;
  username: string;
  password: string;
  passwordHash: string;
}

export interface TestContext {
  root: string;
  config: Config;
  db: Database.Database;
  app: FastifyInstance & { worker?: Worker };
}

export function createTempConfig(prefix: string): { root: string; config: Config } {
  const root = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const config: Config = {
    ...baseConfig,
    DATA_DIR: root,
    LIBRARY_PATH: join(root, 'library'),
    INGEST_PATH: join(root, 'ingest'),
  };
  mkdirSync(config.LIBRARY_PATH, { recursive: true });
  mkdirSync(config.INGEST_PATH, { recursive: true });
  return { root, config };
}

export function createTestDatabase(config: Config): Database.Database {
  const db = new Database(join(config.DATA_DIR, 'sonarly.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export async function seedUser(
  db: Database.Database,
  username: string,
  password: string,
  isAdmin = true
): Promise<SeededUser> {
  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  createUser(db, {
    id,
    username,
    passwordHash,
    isAdmin,
    createdAt: new Date().toISOString(),
  });
  return { id, username, password, passwordHash };
}

export function buildSubsonicUrl(
  username: string,
  passwordHash: string,
  baseUrl: string
): string {
  const salt = randomUUID();
  const token = buildSubsonicToken(passwordHash, salt);
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}u=${encodeURIComponent(username)}&t=${token}&s=${salt}&f=json`;
}

export async function login(app: FastifyInstance, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Login failed: ${res.statusCode} ${res.body}`);
  }
  const cookie = res.cookies.find((c) => c.name === 'sessionId');
  if (!cookie) throw new Error('No session cookie returned');
  return cookie.value;
}

export async function waitForJob(
  db: Database.Database,
  type: string,
  timeoutMs = 10000,
  intervalMs = 100
): Promise<{ status: string; stats?: Record<string, unknown> }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = db
      .prepare(
        "SELECT status, stats FROM scan_jobs WHERE type = ? ORDER BY started_at DESC, rowid DESC LIMIT 1"
      )
      .get(type) as { status: string; stats: string | null } | undefined;
    if (row) {
      if (row.status === 'completed') {
        return { status: 'completed', stats: row.stats ? JSON.parse(row.stats) : undefined };
      }
      if (row.status === 'failed') {
        throw new Error(`Job type ${type} failed: ${row.stats}`);
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for job type ${type}`);
}

export async function closeAppAndCleanup(
  app: FastifyInstance & { worker?: Worker },
  root: string
): Promise<void> {
  try {
    await app.close();
  } finally {
    try {
      if (app.worker && app.worker.threadId) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), 3000);
          app.worker!.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

export async function buildTestApp(
  config: Config,
  db: Database.Database
): Promise<FastifyInstance & { worker?: Worker }> {
  return buildApp(config, db) as Promise<FastifyInstance & { worker?: Worker }>;
}
