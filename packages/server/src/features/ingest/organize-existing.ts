import { readdir, rmdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { getSongByPath } from '../songs/index.js';
import { getOrganizePattern } from '../settings/index.js';
import { readTags } from '../tags/index.js';
import { buildTargetPath, moveToLibrary } from './organizer.js';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a']);

export interface OrganizeStats {
  scanned: number;
  moved: number;
  skipped: number;
  failed: number;
}

export async function organizeSongFile(config: Config, db: Database.Database, filePath: string): Promise<string> {
  const dbSong = getSongByPath(db, filePath);
  const meta = await readTags(filePath);
  const pattern = getOrganizePattern(db, config);
  const targetPath = buildTargetPath(pattern, config.LIBRARY_PATH, meta.tags, filePath);

  if (filePath === targetPath) {
    return filePath;
  }

  const finalPath = await moveToLibrary(filePath, targetPath);

  if (dbSong) {
    db.prepare('UPDATE songs SET file_path = ? WHERE id = ?').run(finalPath, dbSong.id);
  }

  return finalPath;
}

export async function organizeExistingLibrary(config: Config, db: Database.Database): Promise<OrganizeStats> {
  const stats: OrganizeStats = { scanned: 0, moved: 0, skipped: 0, failed: 0 };

  for await (const filePath of walkLibraryFiles(config.LIBRARY_PATH)) {
    stats.scanned++;
    try {
      const finalPath = await organizeSongFile(config, db, filePath);
      if (finalPath === filePath) {
        stats.skipped++;
      } else {
        stats.moved++;
      }
    } catch (err) {
      stats.failed++;
      console.error(`Organize failed for ${filePath}`, err);
    }
  }

  try {
    await cleanupEmptyDirs(config.LIBRARY_PATH, config.LIBRARY_PATH);
  } catch (err) {
    console.error('Failed to clean up empty directories after organizing', err);
  }

  return stats;
}

async function cleanupEmptyDirs(dir: string, root: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await cleanupEmptyDirs(join(dir, entry.name), root);
    }
  }
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  if (entries.length === 0 && dir !== root) {
    try {
      await rmdir(dir);
    } catch {}
  }
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
