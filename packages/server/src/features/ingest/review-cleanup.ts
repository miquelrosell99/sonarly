import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface ReviewCleanupStats extends Record<string, number> {
  deleted: number;
  failed: number;
}

export async function cleanupReviewFolder(reviewDir: string, retentionDays: number): Promise<ReviewCleanupStats> {
  const stats: ReviewCleanupStats = { deleted: 0, failed: 0 };
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let entries;
  try {
    entries = await readdir(reviewDir, { withFileTypes: true });
  } catch {
    return stats;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = join(reviewDir, entry.name);
    try {
      const fileStat = await stat(filePath);
      if (fileStat.mtimeMs < cutoff) {
        await unlink(filePath);
        stats.deleted++;
      }
    } catch {
      stats.failed++;
    }
  }

  return stats;
}

export async function cleanupAllReviewFolders(ingestPath: string, retentionDays: number): Promise<ReviewCleanupStats> {
  const total: ReviewCleanupStats = { deleted: 0, failed: 0 };

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'review') {
          const stats = await cleanupReviewFolder(fullPath, retentionDays);
          total.deleted += stats.deleted;
          total.failed += stats.failed;
        } else {
          await walk(fullPath);
        }
      }
    }
  }

  await walk(ingestPath);
  return total;
}
