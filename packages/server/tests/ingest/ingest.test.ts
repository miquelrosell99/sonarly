import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/db/migrate.js';
import { processIngestFolder } from '../../src/ingest/ingest.js';
import type { Config } from '../../src/config.js';

const fixturePath = new URL('../fixtures/sample.mp3', import.meta.url).pathname;

describe('processIngestFolder', () => {
  let db: Database.Database;
  let libraryPath: string;
  let ingestPath: string;
  let config: Config;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    libraryPath = join(tmpdir(), `sonarly-lib-${randomUUID()}`);
    ingestPath = join(tmpdir(), `sonarly-ingest-${randomUUID()}`);
    mkdirSync(libraryPath, { recursive: true });
    mkdirSync(ingestPath, { recursive: true });
    config = { PORT: 3000, DATA_DIR: '/data', LIBRARY_PATH: libraryPath, INGEST_PATH: ingestPath, ORGANIZE_PATTERN: '{artist}/{album}/{title}{ext}', SCAN_INTERVAL_MINUTES: 60, WATCHER_USE_POLLING: false, PUID: 1000, PGID: 1000, NODE_ENV: 'test', SESSION_SECRET: 'a'.repeat(32) };
  });

  afterEach(() => {
    db.close();
    rmSync(libraryPath, { recursive: true, force: true });
    rmSync(ingestPath, { recursive: true, force: true });
  });

  it('moves unsupported files to review', async () => {
    writeFileSync(join(ingestPath, 'readme.txt'), 'not audio');
    const stats = await processIngestFolder(config, db);
    expect(stats.processed).toBe(0);
  });

  it('imports a tagged audio file into the library', async () => {
    copyFileSync(fixturePath, join(ingestPath, 'sample.mp3'));
    const stats = await processIngestFolder(config, db);
    expect(stats.processed).toBe(1);
    expect(stats.imported).toBe(1);
    expect(stats.needsReview).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('moves files with missing required tags to review', async () => {
    writeFileSync(join(ingestPath, 'sample.mp3'), 'invalid mp3 content without tags');
    const stats = await processIngestFolder(config, db);
    expect(stats.processed).toBe(1);
    expect(stats.needsReview).toBe(1);
  });

  it('renames duplicate basenames in review directory', async () => {
    const subA = join(ingestPath, 'sub-a');
    const subB = join(ingestPath, 'sub-b');
    mkdirSync(subA, { recursive: true });
    mkdirSync(subB, { recursive: true });
    writeFileSync(join(subA, 'sample.mp3'), 'invalid mp3 content without tags');
    writeFileSync(join(subB, 'sample.mp3'), 'different invalid content');
    const stats = await processIngestFolder(config, db);
    expect(stats.processed).toBe(2);
    expect(stats.needsReview).toBe(2);
    const reviewDir = join(ingestPath, 'review');
    expect(existsSync(join(reviewDir, 'sample.mp3'))).toBe(true);
    expect(existsSync(join(reviewDir, 'sample (1).mp3'))).toBe(true);
  });
});
