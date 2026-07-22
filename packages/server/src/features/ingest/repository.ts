import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export function createIngestJob(db: Database.Database, sourcePath: string): string {
  const id = randomUUID();
  db.prepare('INSERT INTO ingest_jobs (id, source_path, status) VALUES (?, ?, ?)')
    .run(id, sourcePath, 'pending');
  return id;
}

export function updateIngestJob(
  db: Database.Database,
  id: string,
  status: string,
  targetPath?: string,
  error?: string
): void {
  db.prepare("UPDATE ingest_jobs SET status = ?, target_path = ?, error = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, targetPath ?? null, error ?? null, id);
}
