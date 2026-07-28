import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync, copyFileSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import NodeID3 from 'node-id3';
import { migrate } from '../../../src/db/migrate.js';
import { scanLibrary } from '../../../src/features/library/scanner.js';
import type { Config } from '../../../src/config.js';

const fixture = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;

function createMinimalFlacWithComments(comments: string[]): Buffer {
  const streaminfo = createMetadataBlock(0, false, buildStreaminfo());
  const vorbisComment = createMetadataBlock(4, true, buildVorbisComment(comments));
  return Buffer.concat([Buffer.from('fLaC'), streaminfo, vorbisComment]);
}

function buildStreaminfo(): Buffer {
  const buf = Buffer.alloc(34);
  buf.writeUInt16BE(4096, 0);
  buf.writeUInt16BE(4096, 2);
  buf.writeUInt8(0, 4);
  buf.writeUInt8(0, 5);
  buf.writeUInt8(1, 6);
  buf.writeUInt8(0, 7);
  buf.writeUInt8(0, 8);
  buf.writeUInt8(1, 9);
  const packed = (44100n << 44n) | (1n << 41n) | (15n << 36n) | 0n;
  buf.writeBigUInt64BE(packed, 10);
  return buf;
}

function buildVorbisComment(comments: string[]): Buffer {
  const vendor = Buffer.from('sonarly-test');
  const commentBuffers = comments.map((c) => {
    const b = Buffer.from(c);
    const h = Buffer.alloc(4);
    h.writeUInt32LE(b.length, 0);
    return Buffer.concat([h, b]);
  });
  const buf = Buffer.alloc(4 + vendor.length + 4);
  let offset = 0;
  buf.writeUInt32LE(vendor.length, offset);
  offset += 4;
  vendor.copy(buf, offset);
  offset += vendor.length;
  buf.writeUInt32LE(comments.length, offset);
  return Buffer.concat([buf, ...commentBuffers]);
}

function createMetadataBlock(typeId: number, lastBlock: boolean, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8((lastBlock ? 0x80 : 0x00) | (typeId & 0x7f), 0);
  header.writeUInt8((data.length >> 16) & 0xff, 1);
  header.writeUInt8((data.length >> 8) & 0xff, 2);
  header.writeUInt8(data.length & 0xff, 3);
  return Buffer.concat([header, data]);
}

describe('scanLibrary', () => {
  let db: Database.Database;
  let libraryPath: string;
  let config: Config;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    libraryPath = join(tmpdir(), `sonarly-scan-${Date.now()}`);
    mkdirSync(libraryPath, { recursive: true });
    config = {
      PORT: 3000,
      NODE_ENV: 'test',
      SESSION_SECRET: 'a'.repeat(32),
      DATA_DIR: '/data',
      LIBRARY_PATH: libraryPath,
      INGEST_PATH: '/data/ingest',
      SCAN_INTERVAL_MINUTES: 60,
      WATCHER_USE_POLLING: false,
      PUID: 1000,
      PGID: 1000,
    };
  });

  afterEach(() => {
    db.close();
    rmSync(libraryPath, { recursive: true, force: true });
  });

  it('adds a new audio file to the database', async () => {
    const target = join(libraryPath, 'Artist', 'Album', 'Song.mp3');
    mkdirSync(join(libraryPath, 'Artist', 'Album'), { recursive: true });
    copyFileSync(fixture, target);

    const stats = await scanLibrary(config, db);

    expect(stats.scanned).toBe(1);
    expect(stats.added).toBe(1);
    expect(stats.failed).toBe(0);
    const row = db.prepare('SELECT * FROM songs WHERE file_path = ?').get(target) as any;
    expect(row).toBeDefined();
    expect(row.title).toBe('Sample Song');
    expect(row.artist_id).toBeDefined();
    expect(row.album_id).toBeDefined();
  });

  it('skips unchanged files on rescan', async () => {
    const target = join(libraryPath, 'Song.mp3');
    copyFileSync(fixture, target);
    await scanLibrary(config, db);

    const stats = await scanLibrary(config, db);

    expect(stats.scanned).toBe(1);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
  });

  it('updates a file when its mtime changes', async () => {
    const target = join(libraryPath, 'Song.mp3');
    copyFileSync(fixture, target);
    await scanLibrary(config, db);
    const before = db.prepare('SELECT mtime FROM songs WHERE file_path = ?').pluck().get(target) as number;

    const future = Date.now() + 60_000;
    utimesSync(target, future / 1000, future / 1000);
    const stats = await scanLibrary(config, db);

    expect(stats.updated).toBe(1);
    const after = db.prepare('SELECT mtime FROM songs WHERE file_path = ?').pluck().get(target) as number;
    expect(after).toBeGreaterThan(before);
  });

  it('detects moved files by checksum and preserves the song id', async () => {
    const oldPath = join(libraryPath, 'Old', 'Song.mp3');
    const newPath = join(libraryPath, 'New', 'Song.mp3');
    mkdirSync(join(libraryPath, 'Old'), { recursive: true });
    mkdirSync(join(libraryPath, 'New'), { recursive: true });
    copyFileSync(fixture, oldPath);
    await scanLibrary(config, db);
    const beforeId = db.prepare('SELECT id FROM songs WHERE file_path = ?').pluck().get(oldPath) as string;

    rmSync(oldPath);
    copyFileSync(fixture, newPath);
    const stats = await scanLibrary(config, db);

    expect(stats.moved).toBe(1);
    expect(stats.removed).toBe(0);
    const afterId = db.prepare('SELECT id FROM songs WHERE file_path = ?').pluck().get(newPath) as string;
    expect(afterId).toBe(beforeId);
    const oldRow = db.prepare('SELECT * FROM songs WHERE file_path = ?').get(oldPath) as any;
    expect(oldRow).toBeUndefined();
  });

  it('marks database entries inactive for files no longer on disk', async () => {
    const target = join(libraryPath, 'Song.mp3');
    copyFileSync(fixture, target);
    await scanLibrary(config, db);

    rmSync(target);
    const stats = await scanLibrary(config, db);

    expect(stats.removed).toBe(1);
    const row = db.prepare('SELECT * FROM songs WHERE file_path = ?').get(target) as any;
    expect(row).toBeDefined();
    expect(row.active).toBe(0);
  });

  it('reactivates an inactive song when the file reappears', async () => {
    const target = join(libraryPath, 'Song.mp3');
    copyFileSync(fixture, target);
    await scanLibrary(config, db);

    rmSync(target);
    await scanLibrary(config, db);

    copyFileSync(fixture, target);
    const stats = await scanLibrary(config, db);

    expect(stats.updated).toBe(1);
    const row = db.prepare('SELECT * FROM songs WHERE file_path = ?').get(target) as any;
    expect(row).toBeDefined();
    expect(row.active).toBe(1);
  });

  it('populates multi-value artists and rich metadata', async () => {
    const target = join(libraryPath, 'Rich', 'Album', 'Song.mp3');
    mkdirSync(join(libraryPath, 'Rich', 'Album'), { recursive: true });
    copyFileSync(fixture, target);
    NodeID3.write(
      {
        title: 'Rich Song',
        artist: 'Artist A / Artist B',
        albumArtist: 'Album Artist A / Album Artist B',
        album: 'Rich Album',
        composer: 'Composer A',
        genre: 'Rock',
        year: '2020',
        trackNumber: '1/10',
      },
      target,
    );

    const stats = await scanLibrary(config, db);

    expect(stats.added).toBe(1);
    const song = db.prepare('SELECT * FROM songs WHERE title = ?').get('Rich Song') as any;
    expect(song).toBeDefined();
    expect(song.total_tracks).toBe('10');

    const songArtists = db.prepare('SELECT ar.name FROM song_artists sa JOIN artists ar ON ar.id = sa.artist_id WHERE sa.song_id = ? ORDER BY sa.position')
      .pluck().all(song.id) as string[];
    expect(songArtists).toEqual(['Artist A', 'Artist B']);

    const songComposers = db.prepare('SELECT ar.name FROM song_composers sc JOIN artists ar ON ar.id = sc.artist_id WHERE sc.song_id = ? ORDER BY sc.position')
      .pluck().all(song.id) as string[];
    expect(songComposers).toEqual(['Composer A']);

    const album = db.prepare('SELECT * FROM albums WHERE name = ?').get('Rich Album') as any;
    expect(album).toBeDefined();
    const albumArtists = db.prepare('SELECT ar.name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id WHERE aa.album_id = ? ORDER BY aa.position')
      .pluck().all(album.id) as string[];
    // node-id3 in this setup does not expose albumArtist to music-metadata, so the scanner falls back to track artists.
    expect(albumArtists).toEqual(songArtists);
  });

  it('populates multi-value genres from a FLAC file', async () => {
    const target = join(libraryPath, 'GenreArtist', 'Album', 'Song.flac');
    mkdirSync(join(libraryPath, 'GenreArtist', 'Album'), { recursive: true });
    writeFileSync(target, createMinimalFlacWithComments([
      'TITLE=Genre Song',
      'ARTIST=Genre Artist',
      'ALBUM=Genre Album',
      'GENRE=Rock',
      'GENRE=Alternative',
    ]));

    const stats = await scanLibrary(config, db);

    expect(stats.added).toBe(1);
    const song = db.prepare('SELECT * FROM songs WHERE title = ?').get('Genre Song') as any;
    expect(song).toBeDefined();
    expect(song.genre).toBe('Rock');

    const genres = db.prepare(`
      SELECT g.name
      FROM song_genres sg
      JOIN genres g ON g.id = sg.genre_id
      WHERE sg.song_id = ?
      ORDER BY sg.position
    `).pluck().all(song.id) as string[];
    expect(genres).toEqual(['Rock', 'Alternative']);

    const album = db.prepare('SELECT * FROM albums WHERE name = ?').get('Genre Album') as any;
    expect(album).toBeDefined();
    const albumGenres = db.prepare(`
      SELECT g.name
      FROM album_genres ag
      JOIN genres g ON g.id = ag.genre_id
      WHERE ag.album_id = ?
      ORDER BY ag.position
    `).pluck().all(album.id) as string[];
    expect(albumGenres).toEqual(['Rock', 'Alternative']);
  });

  it('ignores non-audio files', async () => {
    writeFileSync(join(libraryPath, 'notes.txt'), 'hello');
    const stats = await scanLibrary(config, db);

    expect(stats.scanned).toBe(0);
    expect(stats.added).toBe(0);
  });

  it('logs and skips unreadable directories instead of aborting', async () => {
    if (process.getuid && process.getuid() === 0) {
      // Permission checks are bypassed for root, so EACCES cannot be triggered.
      return;
    }

    const readableDir = join(libraryPath, 'accessible');
    const unreadableDir = join(libraryPath, 'locked');
    mkdirSync(readableDir, { recursive: true });
    mkdirSync(unreadableDir, { recursive: true });
    const target = join(readableDir, 'Song.mp3');
    copyFileSync(fixture, target);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    chmodSync(unreadableDir, 0o000);
    try {
      const stats = await scanLibrary(config, db);

      expect(stats.scanned).toBe(1);
      expect(stats.failed).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('locked'), expect.anything());
    } finally {
      chmodSync(unreadableDir, 0o755);
      errorSpy.mockRestore();
    }
  });
});
