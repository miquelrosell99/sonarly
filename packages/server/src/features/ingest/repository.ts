import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DuplicateStrategy } from '@sonarly/shared';

export function createIngestJob(db: Database.Database, sourcePath: string, runId: string): string {
  const id = randomUUID();
  db.prepare('INSERT INTO ingest_jobs (id, run_id, source_path, status) VALUES (?, ?, ?, ?)')
    .run(id, runId, sourcePath, 'pending');
  return id;
}

export function updateIngestJob(
  db: Database.Database,
  id: string,
  status: string,
  targetPath?: string,
  error?: string,
  duplicate?: boolean,
  duplicateStrategy?: DuplicateStrategy,
): void {
  db.prepare(`
    UPDATE ingest_jobs
    SET status = ?,
        target_path = ?,
        error = ?,
        duplicate = ?,
        duplicate_strategy = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    status,
    targetPath ?? null,
    error ?? null,
    duplicate ? 1 : 0,
    duplicateStrategy ?? null,
    id,
  );
}
