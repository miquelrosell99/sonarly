import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { pushJob } from './queue.js';
import { getSetting, setSetting } from '../settings/index.js';

export class ScanScheduler {
  private readonly intervalMs: number;
  private readonly libraryPath: string;

  constructor(config: Config) {
    this.intervalMs = config.SCAN_INTERVAL_MINUTES > 0 ? config.SCAN_INTERVAL_MINUTES * 60 * 1000 : 0;
    this.libraryPath = config.LIBRARY_PATH;
  }

  tick(db: Database.Database, now = Date.now()): void {
    if (this.intervalMs === 0) return;

    const lastRaw = getSetting(db, 'last_periodic_scan', '');
    if (!lastRaw) {
      setSetting(db, 'last_periodic_scan', new Date(now).toISOString());
      return;
    }

    const last = new Date(lastRaw).getTime();
    if (Number.isNaN(last)) {
      setSetting(db, 'last_periodic_scan', new Date(now).toISOString());
      return;
    }

    if (now - last < this.intervalMs) return;
    if (this.hasPendingOrRunningScan(db)) return;

    pushJob(db, 'scan', this.libraryPath);
    setSetting(db, 'last_periodic_scan', new Date(now).toISOString());
  }

  private hasPendingOrRunningScan(db: Database.Database): boolean {
    const row = db.prepare(
      "SELECT 1 FROM scan_jobs WHERE type IN ('scan', 'resync') AND status IN ('pending', 'running') LIMIT 1"
    ).get();
    return row !== undefined;
  }
}
