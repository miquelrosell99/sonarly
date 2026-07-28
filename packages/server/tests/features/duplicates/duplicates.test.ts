import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import NodeID3 from 'node-id3';
import { migrate } from '../../../src/db/migrate.js';
import { processIngestFolder } from '../../../src/features/ingest/ingest.js';
import { getSongById } from '../../../src/features/songs/repository.js';
import { getSongGenreNames } from '../../../src/features/genres/repository.js';
import { setDuplicateStrategy } from '../../../src/features/settings/repository.js';
import type { Config } from '../../../src/config.js';

const fixturePath = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;

describe('duplicate song handling', () => {
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
    config = {
      PORT: 3000,
      DATA_DIR: '/data',
      LIBRARY_PATH: libraryPath,
      INGEST_PATH: ingestPath,
      ORGANIZE_PATTERN: '{artist}/{album}/{title}',
      SCAN_INTERVAL_MINUTES: 60,
      WATCHER_USE_POLLING: false,
      PUID: 1000,
      PGID: 1000,
      NODE_ENV: 'test',
      SESSION_SECRET: 'a'.repeat(32),
    };
  });

  afterEach(() => {
    db.close();
    rmSync(libraryPath, { recursive: true, force: true });
    rmSync(ingestPath, { recursive: true, force: true });
  });

  it('counts duplicate when same title/album/artists are ingested again', async () => {
    copyFileSync(fixturePath, join(ingestPath, 'first.mp3'));
    const first = await processIngestFolder(config, db);
    expect(first.imported).toBe(1);
    expect(first.duplicates).toBe(0);

    copyFileSync(fixturePath, join(ingestPath, 'second.mp3'));
    const second = await processIngestFolder(config, db);
    expect(second.processed).toBe(1);
    expect(second.imported).toBe(1);
    expect(second.duplicates).toBe(1);
  });

  it('replaces existing file with replace_file_and_metadata strategy', async () => {
    setDuplicateStrategy(db, 'replace_file_and_metadata');

    copyFileSync(fixturePath, join(ingestPath, 'first.mp3'));
    await processIngestFolder(config, db);

    const firstLibraryPath = db.prepare('SELECT file_path FROM songs WHERE active = 1').pluck().get() as string;

    const secondPath = join(ingestPath, 'second.mp3');
    copyFileSync(fixturePath, secondPath);
    // Give the second file a different genre so we can verify metadata was replaced.
    NodeID3.write(
      { title: 'Sample Song', artist: 'Sample Artist', album: 'Sample Album', genre: 'Replaced', year: 2024 },
      secondPath,
    );

    const second = await processIngestFolder(config, db);
    expect(second.duplicates).toBe(1);

    const song = getSongById(db, db.prepare('SELECT id FROM songs WHERE active = 1').pluck().get() as string);
    expect(song).toBeDefined();
    expect(song!.genre).toBe('Replaced');
    expect(existsSync(song!.filePath)).toBe(true);
    if (firstLibraryPath && firstLibraryPath !== song!.filePath) {
      expect(existsSync(firstLibraryPath)).toBe(false);
    }
  });

  it('keeps existing file with keep_file_replace_metadata strategy', async () => {
    setDuplicateStrategy(db, 'keep_file_replace_metadata');

    copyFileSync(fixturePath, join(ingestPath, 'first.mp3'));
    await processIngestFolder(config, db);

    const firstLibraryPath = db.prepare('SELECT file_path FROM songs WHERE active = 1').pluck().get() as string;
    const firstSize = readFileSync(firstLibraryPath).length;

    const secondPath = join(ingestPath, 'second.mp3');
    copyFileSync(fixturePath, secondPath);
    NodeID3.write(
      { title: 'Sample Song', artist: 'Sample Artist', album: 'Sample Album', genre: 'Rock', year: 2025 },
      secondPath,
    );

    const second = await processIngestFolder(config, db);
    expect(second.duplicates).toBe(1);

    const song = getSongById(db, db.prepare('SELECT id FROM songs WHERE active = 1').pluck().get() as string);
    expect(song?.filePath).toBe(firstLibraryPath);
    expect(readFileSync(song!.filePath).length).toBe(firstSize);
    expect(song?.genre).toBe('Rock');
    expect(song?.year).toBe(2025);
  });

  it('aggregates genres with keep_file_aggregate_metadata strategy', async () => {
    setDuplicateStrategy(db, 'keep_file_aggregate_metadata');

    copyFileSync(fixturePath, join(ingestPath, 'first.mp3'));
    await processIngestFolder(config, db);

    const songId = db.prepare('SELECT id FROM songs WHERE active = 1').pluck().get() as string;
    const firstGenres = getSongGenreNames(db, songId);
    expect(firstGenres).toContain('Sample');

    const secondPath = join(ingestPath, 'second.mp3');
    copyFileSync(fixturePath, secondPath);
    NodeID3.write(
      { title: 'Sample Song', artist: 'Sample Artist', album: 'Sample Album', genre: 'Rock' },
      secondPath,
    );

    const second = await processIngestFolder(config, db);
    expect(second.duplicates).toBe(1);

    const mergedGenres = getSongGenreNames(db, songId);
    expect(mergedGenres).toContain('Sample');
    expect(mergedGenres).toContain('Rock');
  });

  it('does not treat different albums as duplicates', async () => {
    copyFileSync(fixturePath, join(ingestPath, 'first.mp3'));
    await processIngestFolder(config, db);

    const secondPath = join(ingestPath, 'second.mp3');
    copyFileSync(fixturePath, secondPath);
    NodeID3.write(
      { title: 'Sample Song', artist: 'Sample Artist', album: 'Different Album' },
      secondPath,
    );

    const second = await processIngestFolder(config, db);
    expect(second.duplicates).toBe(0);
    expect(second.imported).toBe(1);
  });
});
