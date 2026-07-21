import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { getSongByPath } from '../db/repositories/song-repository.js';
import { readTags } from '../tags/reader.js';
import { buildTargetPath, moveToLibrary } from './organizer.js';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a']);

export interface OrganizeStats {
  scanned: number;
  moved: number;
  skipped: number;
  failed: number;
}

export async function organizeExistingLibrary(config: Config, db: Database.Database): Promise<OrganizeStats> {
  const stats: OrganizeStats = { scanned: 0, moved: 0, skipped: 0, failed: 0 };

  for await (const filePath of walkLibraryFiles(config.LIBRARY_PATH)) {
    stats.scanned++;
    try {
      const dbSong = getSongByPath(db, filePath);
      const meta = await readTags(filePath);
      const targetPath = buildTargetPath(config.ORGANIZE_PATTERN, config.LIBRARY_PATH, meta.tags, filePath);

      if (filePath === targetPath) {
        stats.skipped++;
        continue;
      }

      const finalPath = await moveToLibrary(filePath, targetPath);

      if (dbSong) {
        db.prepare('UPDATE songs SET file_path = ? WHERE id = ?').run(finalPath, dbSong.id);
      }

      stats.moved++;
    } catch (err) {
      stats.failed++;
      console.error(`Organize failed for ${filePath}`, err);
    }
  }

  return stats;
}

async function* walkLibraryFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkLibraryFiles(fullPath);
    } else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}
