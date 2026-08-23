import Database from 'better-sqlite3';

export interface ScanJob {
  id: string;
  type: 'full' | 'incremental' | 'watch';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  stats?: Record<string, number>;
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
