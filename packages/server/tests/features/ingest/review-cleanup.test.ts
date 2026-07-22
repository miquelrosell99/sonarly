import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupReviewFolder } from '../../../src/features/ingest/review-cleanup.js';

describe('cleanupReviewFolder', () => {
  let reviewDir: string;

  beforeEach(() => {
    reviewDir = join(tmpdir(), `sonarly-review-${randomUUID()}`);
    mkdirSync(reviewDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(reviewDir, { recursive: true, force: true });
  });

  it('deletes files older than the retention period', async () => {
    const oldFile = join(reviewDir, 'old.mp3');
    const newFile = join(reviewDir, 'new.mp3');
    writeFileSync(oldFile, 'old');
    writeFileSync(newFile, 'new');

    const oldMtime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const newMtime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    // The test relies on the actual filesystem mtime; touch them explicitly.
    const { utimesSync } = await import('node:fs');
    utimesSync(oldFile, oldMtime, oldMtime);
    utimesSync(newFile, newMtime, newMtime);

    const stats = await cleanupReviewFolder(reviewDir, 30);
    expect(stats.deleted).toBe(1);
    expect(stats.failed).toBe(0);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
  });

  it('returns zero stats when the review directory does not exist', async () => {
    const stats = await cleanupReviewFolder(join(reviewDir, 'missing'), 30);
    expect(stats.deleted).toBe(0);
    expect(stats.failed).toBe(0);
  });
});
