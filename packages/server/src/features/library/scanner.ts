import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { readTags, computeChecksum } from '../tags/index.js';
import { upsertSong, deleteSongByPath, getSongByPath } from '../songs/index.js';
import { upsertArtist } from '../artists/index.js';
import { upsertAlbum } from '../albums/index.js';
import type { Song, SongTags } from '@sonarly/shared';
import { randomUUID } from 'node:crypto';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a']);

export interface ScanStats extends Record<string, number> {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  moved: number;
  failed: number;
}

export async function scanLibrary(config: Config, db: Database.Database): Promise<ScanStats> {
  const stats: ScanStats = { scanned: 0, added: 0, updated: 0, removed: 0, moved: 0, failed: 0 };
  const foundPaths = new Set<string>();
  const checksumToSong = new Map<string, Song>();
  const movedFromPaths = new Set<string>();

  for await (const filePath of walkAudioFiles(config.LIBRARY_PATH)) {
    stats.scanned++;
    foundPaths.add(filePath);
    try {
      const existing = getSongByPath(db, filePath);
      const mtime = (await stat(filePath)).mtimeMs;
      if (existing && existing.mtime === mtime) continue;

      const meta = await readTags(filePath);
      const checksum = await computeChecksum(filePath);

      if (!existing) {
        const cached = checksumToSong.get(checksum);
        const movedFrom = (cached && !foundPaths.has(cached.filePath) ? cached : undefined)
          ?? findMovedSong(db, checksum, foundPaths);
        if (movedFrom) {
          const song = await persistSong(db, filePath, meta.tags, meta.duration, meta.hasCoverArt, mtime, checksum, movedFrom.id);
          checksumToSong.set(checksum, song);
          movedFromPaths.add(movedFrom.filePath);
          stats.moved++;
        } else {
          const song = await persistSong(db, filePath, meta.tags, meta.duration, meta.hasCoverArt, mtime, checksum);
          checksumToSong.set(checksum, song);
          stats.added++;
        }
      } else {
        await persistSong(db, filePath, meta.tags, meta.duration, meta.hasCoverArt, mtime, checksum, existing.id);
        stats.updated++;
      }
    } catch (err) {
      stats.failed++;
      console.error(`Scan failed for ${filePath}`, err);
    }
  }

  // Remove missing files
  const allDbPaths = db.prepare('SELECT file_path FROM songs').pluck().all() as string[];
  for (const dbPath of allDbPaths) {
    if (!foundPaths.has(dbPath) && !movedFromPaths.has(dbPath)) {
      deleteSongByPath(db, dbPath);
      stats.removed++;
    }
  }

  return stats;
}

async function* walkAudioFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`Scanner: cannot read directory ${dir}`, err);
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkAudioFiles(fullPath);
    } else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}

function findMovedSong(db: Database.Database, checksum: string, foundPaths: Set<string>): Song | undefined {
  const rows = db.prepare('SELECT * FROM songs WHERE checksum = ?').all(checksum) as any[];
  for (const row of rows) {
    const song = { ...row, filePath: row.file_path } as Song;
    if (!foundPaths.has(song.filePath)) {
      return song;
    }
  }
  return undefined;
}

async function persistSong(
  db: Database.Database,
  filePath: string,
  tags: SongTags,
  duration: number | undefined,
  hasCoverArt: boolean,
  mtime: number,
  checksum: string,
  existingId?: string
): Promise<Song> {
  const artistName = tags.artist;
  const artistId = artistName ? ensureArtist(db, artistName) : undefined;
  const albumArtist = tags.albumArtist || artistName;
  const albumId = tags.album ? ensureAlbum(db, tags.album, albumArtist, artistId, tags.year, tags.genre) : undefined;
  const id = existingId ?? randomUUID();

  const song: Song = {
    id,
    filePath,
    title: tags.title,
    trackNumber: tags.trackNumber,
    discNumber: tags.discNumber,
    duration,
    artistId,
    albumId,
    genre: tags.genre,
    year: tags.year,
    explicit: tags.explicit,
    coverArt: hasCoverArt ? id : undefined,
    mtime,
    checksum,
  };
  upsertSong(db, song);
  return song;
}

function ensureArtist(db: Database.Database, name: string): string {
  const existing = db.prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE').pluck().get(name) as string | undefined;
  if (existing) return existing;
  const id = randomUUID();
  upsertArtist(db, { id, name });
  return id;
}

function ensureAlbum(db: Database.Database, name: string, artistName: string | undefined, artistId: string | undefined, year?: number, genre?: string): string {
  const existing = artistId
    ? db.prepare('SELECT id FROM albums WHERE name = ? COLLATE NOCASE AND artist_id = ?').pluck().get(name, artistId) as string | undefined
    : db.prepare('SELECT id FROM albums WHERE name = ? COLLATE NOCASE AND artist_id IS NULL').pluck().get(name) as string | undefined;
  if (existing) return existing;
  const id = randomUUID();
  upsertAlbum(db, { id, name, artistId, artistName, year, genre });
  return id;
}
