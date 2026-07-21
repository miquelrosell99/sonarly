import { readdir, rename, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { validateIngestFile } from './validator.js';
import { buildTargetPath, moveToLibrary } from './organizer.js';
import { createIngestJob, updateIngestJob } from './repository.js';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a']);

export interface IngestStats extends Record<string, number> {
  processed: number;
  imported: number;
  needsReview: number;
  failed: number;
}

export async function processIngestFolder(config: Config, db: Database.Database): Promise<IngestStats> {
  const stats: IngestStats = { processed: 0, imported: 0, needsReview: 0, failed: 0 };
  const reviewDir = join(config.INGEST_PATH, 'review');
  await mkdir(reviewDir, { recursive: true });

  for await (const filePath of walkIngestFiles(config.INGEST_PATH)) {
    stats.processed++;
    const jobId = createIngestJob(db, filePath);
    try {
      const validation = await validateIngestFile(filePath);
      if (!validation.valid) {
        await moveToReview(filePath, reviewDir);
        updateIngestJob(db, jobId, 'needs_review', undefined, validation.reason);
        stats.needsReview++;
        continue;
      }
      const targetPath = buildTargetPath(config.ORGANIZE_PATTERN, config.LIBRARY_PATH, validation.tags!, filePath);
      const finalPath = await moveToLibrary(filePath, targetPath);
      updateIngestJob(db, jobId, 'imported', finalPath);
      stats.imported++;
    } catch (err) {
      updateIngestJob(db, jobId, 'failed', undefined, String(err));
      stats.failed++;
    }
  }

  return stats;
}

async function* walkIngestFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'review') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkIngestFiles(fullPath);
    } else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}

async function moveToReview(sourcePath: string, reviewDir: string): Promise<void> {
  const target = join(reviewDir, sourcePath.split('/').pop()!);
  await mkdir(dirname(target), { recursive: true });
  await rename(sourcePath, target);
}
