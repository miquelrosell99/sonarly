import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { updateJobStats } from '../library/queue.js';
import {
  cleanupEmptyDirs,
  getTargetPathForFile,
  organizeSongFile,
  walkLibraryFiles,
} from './organize-existing.js';

export interface OrganizeJobStats {
  total: number;
  scanned: number;
  done: number;
  moved: number;
  skipped: number;
  failed: number;
  failedPaths: string[];
  currentPath?: string;
  error?: string;
  [key: string]: unknown;
}

export async function runOrganizeJob(config: Config, db: Database.Database, jobId: string): Promise<OrganizeJobStats> {
  const stats: OrganizeJobStats = { total: 0, scanned: 0, done: 0, moved: 0, skipped: 0, failed: 0, failedPaths: [] };
  const candidates: string[] = [];

  for await (const filePath of walkLibraryFiles(config.LIBRARY_PATH)) {
    stats.scanned++;
    try {
      const targetPath = await getTargetPathForFile(config, db, filePath);
      if (targetPath !== filePath) {
        candidates.push(filePath);
      } else {
        stats.skipped++;
      }
    } catch (err) {
      stats.failed++;
      stats.failedPaths.push(filePath);
      console.error(`Organize preview failed for ${filePath}`, err);
    }
  }

  stats.total = candidates.length;
  updateJobStats(db, jobId, stats);

  for (const filePath of candidates) {
    stats.currentPath = filePath;
    updateJobStats(db, jobId, stats);

    try {
      const finalPath = await organizeSongFile(config, db, filePath);
      if (finalPath === filePath) {
        stats.skipped++;
      } else {
        stats.moved++;
      }
    } catch (err) {
      stats.failed++;
      stats.failedPaths.push(filePath);
      console.error(`Organize failed for ${filePath}`, err);
    }

    stats.done++;
    updateJobStats(db, jobId, stats);
  }

  delete stats.currentPath;

  try {
    await cleanupEmptyDirs(config.LIBRARY_PATH, config.LIBRARY_PATH);
  } catch (err) {
    console.error('Failed to clean up empty directories after organizing', err);
  }

  return stats;
}
