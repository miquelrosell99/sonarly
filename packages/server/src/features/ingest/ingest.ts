import { readdir, rename, mkdir, stat, rmdir, copyFile, unlink } from 'node:fs/promises';
import { extname, join, dirname, basename, parse } from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import type { Library } from '@sonarly/shared';
import { validateIngestFile } from './validator.js';
import { getOrganizePattern } from '../settings/index.js';
import { buildTargetPath, moveToLibrary } from './organizer.js';
import { createIngestJob, updateIngestJob } from './repository.js';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a']);
const COMPANION_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const COMPANION_IMAGE_NAMES = new Set(['cover', 'folder', 'album', 'front', 'art']);

export interface IngestStats extends Record<string, number> {
  processed: number;
  imported: number;
  needsReview: number;
  failed: number;
}

export async function processIngestFolder(
  config: Config,
  db: Database.Database,
  sourcePath?: string,
  targetLibrary?: Library,
): Promise<IngestStats> {
  const root = sourcePath ?? config.INGEST_PATH;
  const libraryPath = targetLibrary?.path ?? config.LIBRARY_PATH;
  const pattern = targetLibrary?.organizePattern ?? getOrganizePattern(db, config);
  const stats: IngestStats = { processed: 0, imported: 0, needsReview: 0, failed: 0 };
  const reviewDir = join(root, 'review');
  await mkdir(reviewDir, { recursive: true });

  const importedSourceDirs = new Map<string, string>();
  const reviewSourceDirs = new Set<string>();

  for await (const filePath of walkIngestFiles(root)) {
    stats.processed++;
    const sourceDir = dirname(filePath);
    const jobId = createIngestJob(db, filePath);
    try {
      const validation = await validateIngestFile(filePath);
      if (!validation.valid) {
        await moveToReview(filePath, reviewDir);
        updateIngestJob(db, jobId, 'needs_review', undefined, validation.reason);
        stats.needsReview++;
        if (sourceDir !== root && !importedSourceDirs.has(sourceDir)) {
          reviewSourceDirs.add(sourceDir);
        }
        continue;
      }
      const targetPath = buildTargetPath(pattern, libraryPath, validation.tags!, filePath);
      const finalPath = await moveToLibrary(filePath, targetPath);
      updateIngestJob(db, jobId, 'imported', finalPath);
      stats.imported++;
      if (sourceDir !== root) {
        importedSourceDirs.set(sourceDir, dirname(finalPath));
        reviewSourceDirs.delete(sourceDir);
      }
    } catch (err) {
      updateIngestJob(db, jobId, 'failed', undefined, String(err));
      stats.failed++;
    }
  }

  // Move companion cover art from imported album folders into the library.
  for (const [sourceDir, targetDir] of importedSourceDirs) {
    try {
      await moveCompanionImages(sourceDir, targetDir);
    } catch (err) {
      console.error(`Failed to move companion images from ${sourceDir}`, err);
    }
  }

  // Move companion cover art for folders where every audio file went to review.
  for (const sourceDir of reviewSourceDirs) {
    try {
      await moveCompanionImages(sourceDir, reviewDir);
    } catch (err) {
      console.error(`Failed to move companion images from ${sourceDir} to review`, err);
    }
  }

  // Remove empty directories left behind in the ingest folder.
  await cleanupEmptyDirs(root, root, reviewDir);

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
  const target = await resolveUniquePath(join(reviewDir, basename(sourcePath)));
  await mkdir(dirname(target), { recursive: true });
  await moveFile(sourcePath, target);
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await rename(sourcePath, targetPath);
  } catch (err) {
    if (isExdev(err)) {
      await copyFile(sourcePath, targetPath);
      await unlink(sourcePath);
    } else {
      throw err;
    }
  }
}

function isExdev(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EXDEV';
}

async function resolveUniquePath(targetPath: string): Promise<string> {
  if (!(await fileExists(targetPath))) return targetPath;
  const { dir, name, ext } = parse(targetPath);
  let counter = 1;
  let candidate = targetPath;
  while (await fileExists(candidate)) {
    candidate = join(dir, `${name} (${counter})${ext}`);
    counter++;
  }
  return candidate;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function moveCompanionImages(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    const base = parse(entry.name).name.toLowerCase();
    if (COMPANION_IMAGE_EXTS.has(ext) && COMPANION_IMAGE_NAMES.has(base)) {
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      await moveToLibrary(sourcePath, targetPath);
    }
  }
}

async function cleanupEmptyDirs(dir: string, root: string, reviewDir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await cleanupEmptyDirs(join(dir, entry.name), root, reviewDir);
    }
  }
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  if (entries.length === 0 && dir !== root && dir !== reviewDir) {
    try {
      await rmdir(dir);
    } catch {}
  }
}
