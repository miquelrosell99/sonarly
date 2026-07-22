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
