import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export type JobType = 'scan' | 'ingest' | 'resync' | 'cleanup_review' | 'organize';

export interface Job {
  id: string;
  type: JobType;
  payload: string;
}

export function pushJob(db: Database.Database, type: JobType, payload: string): string {
  const id = randomUUID();
  db.prepare('INSERT INTO scan_jobs (id, type, status, stats) VALUES (?, ?, ?, ?)')
    .run(id, type, 'pending', JSON.stringify({ path: payload }));
  return id;
}

export function updateJobStats(db: Database.Database, id: string, stats: Record<string, unknown>): void {
  db.prepare('UPDATE scan_jobs SET stats = ? WHERE id = ?')
    .run(JSON.stringify(stats), id);
}

export function popPendingJob(db: Database.Database): Job | undefined {
  const row = db.prepare(`
    SELECT id, type, stats FROM scan_jobs
    WHERE status = 'pending' ORDER BY started_at ASC, rowid ASC LIMIT 1
  `).get() as any;
  if (!row) return undefined;
  const stats = JSON.parse(row.stats || '{}');
  return { id: row.id, type: row.type, payload: stats.path || '' };
}

export function markJobRunning(db: Database.Database, id: string): void {
  db.prepare("UPDATE scan_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?").run(id);
}

export function markJobCompleted(db: Database.Database, id: string, stats: Record<string, unknown>): void {
  db.prepare("UPDATE scan_jobs SET status = 'completed', finished_at = datetime('now'), stats = ? WHERE id = ?")
    .run(JSON.stringify(stats), id);
}

export function markJobFailed(db: Database.Database, id: string, error: string): void {
  db.prepare("UPDATE scan_jobs SET status = 'failed', finished_at = datetime('now'), stats = ? WHERE id = ?")
    .run(JSON.stringify({ error }), id);
}
