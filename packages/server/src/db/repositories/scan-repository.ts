import Database from 'better-sqlite3';

export interface ScanJob {
  id: string;
  type: 'full' | 'incremental' | 'watch';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  stats?: Record<string, number>;
}

export function createScanJob(db: Database.Database, job: ScanJob): void {
  db.prepare('INSERT INTO scan_jobs (id, type, status, started_at, finished_at, stats) VALUES (?, ?, ?, ?, ?, ?)')
    .run(job.id, job.type, job.status, job.startedAt ?? null, job.finishedAt ?? null, job.stats ? JSON.stringify(job.stats) : null);
}

export function updateScanJob(db: Database.Database, job: ScanJob): void {
  db.prepare('UPDATE scan_jobs SET status = ?, started_at = ?, finished_at = ?, stats = ? WHERE id = ?')
    .run(job.status, job.startedAt ?? null, job.finishedAt ?? null, job.stats ? JSON.stringify(job.stats) : null, job.id);
}

export function getLatestScanJob(db: Database.Database): ScanJob | undefined {
  const row = db.prepare('SELECT * FROM scan_jobs ORDER BY started_at DESC LIMIT 1').get() as any;
  if (!row) return undefined;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    stats: row.stats ? JSON.parse(row.stats) : undefined,
  };
}
