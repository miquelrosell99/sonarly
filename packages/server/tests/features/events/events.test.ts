import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';
import { EventBus, registerEventRoutes } from '../../../src/features/events/index.js';
import { buildApp } from '../../../src/app.js';
import { migrate } from '../../../src/db/migrate.js';
import { hashPassword, encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { createUser } from '../../../src/features/users/repository.js';
import type { Config } from '../../../src/config.js';

function createMockReply() {
  const written: string[] = [];
  const raw = {
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
  } as unknown as import('fastify').FastifyReply['raw'];
  const reply = { raw } as unknown as import('fastify').FastifyReply;
  return { reply, written };
}

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

async function seedAdminUser(db: Database.Database) {
  const passwordHash = await hashPassword('adminpass');
  const subsonicPasswordEncrypted = encryptSubsonicPassword('adminpass', baseConfig.SESSION_SECRET);
  createUser(db, {
    id: 'admin-1',
    username: 'admin',
    passwordHash,
    subsonicPasswordEncrypted,
    isAdmin: true,
    createdAt: new Date().toISOString(),
  });
}

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('sends a connected event on subscribe', () => {
    const { reply, written } = createMockReply();
    eventBus.subscribe(reply);
    expect(written.length).toBe(1);
    expect(written[0]).toContain('event: connected');
    expect(eventBus.clientCount()).toBe(1);
  });

  it('broadcasts events to all subscribed clients', () => {
    const clientA = createMockReply();
    const clientB = createMockReply();
    eventBus.subscribe(clientA.reply);
    eventBus.subscribe(clientB.reply);

    eventBus.broadcast({ type: 'library:changed', source: 'ingest' });

    expect(clientA.written.some((chunk) => chunk.includes('event: library:changed'))).toBe(true);
    expect(clientB.written.some((chunk) => chunk.includes('event: library:changed'))).toBe(true);
    expect(clientA.written.some((chunk) => chunk.includes('"source":"ingest"'))).toBe(true);
  });

  it('removes clients on unsubscribe', () => {
    const { reply } = createMockReply();
    eventBus.subscribe(reply);
    eventBus.unsubscribe(reply);
    expect(eventBus.clientCount()).toBe(0);
  });

  it('does not throw when broadcasting to a client whose write fails', () => {
    const failingReply = {
      raw: {
        write: vi.fn(() => {
          throw new Error('write failed');
        }),
      },
    } as unknown as import('fastify').FastifyReply;
    eventBus.subscribe(failingReply);
    expect(() => eventBus.broadcast({ type: 'library:changed' })).not.toThrow();
    expect(eventBus.clientCount()).toBe(0);
  });
});

describe('registerEventRoutes', () => {
  let root: string;
  let config: Config;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    root = join(tmpdir(), `sonarly-events-${Date.now()}`);
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
    await seedAdminUser(db);
    app = await buildApp(config, db);
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events' });
    expect(res.statusCode).toBe(401);
  });

  it('streams SSE events to authenticated clients', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const url = new URL(address);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'admin', password: 'adminpass' },
    });
    expect(loginRes.statusCode).toBe(200);
    const cookies = loginRes.cookies as { name: string; value: string }[];
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        {
          hostname: url.hostname,
          port: url.port,
          path: '/api/events',
          headers: { cookie: cookieHeader },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk.toString());
            if (chunks.join('').includes('event: connected')) {
              req.destroy();
              resolve();
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
          resolve();
        } else {
          reject(err);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
        reject(new Error('SSE request timed out'));
      });
    });

    expect(chunks.join('')).toContain('event: connected');
  });
});
