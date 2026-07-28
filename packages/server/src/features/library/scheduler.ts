import Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { pushJob } from './queue.js';
import { getSetting, setSetting } from '../settings/index.js';

export class ScanScheduler {
  private readonly intervalMs: number;

  constructor(config: Config) {
    this.intervalMs = config.SCAN_INTERVAL_MINUTES > 0 ? config.SCAN_INTERVAL_MINUTES * 60 * 1000 : 0;
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

    pushJob(db, 'scan', '');
    setSetting(db, 'last_periodic_scan', new Date(now).toISOString());
  }

  private hasPendingOrRunningScan(db: Database.Database): boolean {
    const row = db.prepare(
      "SELECT 1 FROM scan_jobs WHERE type IN ('scan', 'resync') AND status IN ('pending', 'running') LIMIT 1"
    ).get();
    return row !== undefined;
  }
}

export class ArtistImageScheduler {
  private readonly intervalMs: number;

  constructor(config: Config) {
    this.intervalMs = config.ARTIST_IMAGE_INTERVAL_MINUTES > 0 ? config.ARTIST_IMAGE_INTERVAL_MINUTES * 60 * 1000 : 0;
  }

  tick(db: Database.Database, now = Date.now()): void {
    if (this.intervalMs === 0) return;

    const lastRaw = getSetting(db, 'last_artist_image_sync', '');
    if (!lastRaw) {
      setSetting(db, 'last_artist_image_sync', new Date(now).toISOString());
      return;
    }

    const last = new Date(lastRaw).getTime();
    if (Number.isNaN(last)) {
      setSetting(db, 'last_artist_image_sync', new Date(now).toISOString());
      return;
    }

    if (now - last < this.intervalMs) return;
    if (this.hasPendingOrRunningSync(db)) return;

    pushJob(db, 'artist_images', JSON.stringify({ refetchExisting: true }));
    setSetting(db, 'last_artist_image_sync', new Date(now).toISOString());
  }

  private hasPendingOrRunningSync(db: Database.Database): boolean {
    const row = db.prepare(
      "SELECT 1 FROM scan_jobs WHERE type = 'artist_images' AND status IN ('pending', 'running') LIMIT 1"
    ).get();
    return row !== undefined;
  }
}

export class IngestScheduler {
  private readonly intervalMs: number;
  private readonly ingestPath: string;

  constructor(config: Config) {
    this.intervalMs = config.INGEST_INTERVAL_MINUTES > 0 ? config.INGEST_INTERVAL_MINUTES * 60 * 1000 : 0;
    this.ingestPath = config.INGEST_PATH;
  }

  tick(db: Database.Database, now = Date.now()): void {
    if (this.intervalMs === 0) return;

    const lastRaw = getSetting(db, 'last_periodic_ingest', '');
    if (!lastRaw) {
      setSetting(db, 'last_periodic_ingest', new Date(now).toISOString());
      return;
    }

    const last = new Date(lastRaw).getTime();
    if (Number.isNaN(last)) {
      setSetting(db, 'last_periodic_ingest', new Date(now).toISOString());
      return;
    }

    if (now - last < this.intervalMs) return;
    if (this.hasPendingOrRunningIngest(db)) return;

    pushJob(db, 'ingest', this.ingestPath);
    setSetting(db, 'last_periodic_ingest', new Date(now).toISOString());
  }

  private hasPendingOrRunningIngest(db: Database.Database): boolean {
    const row = db.prepare(
      "SELECT 1 FROM scan_jobs WHERE type = 'ingest' AND status IN ('pending', 'running') LIMIT 1"
    ).get();
    return row !== undefined;
  }
}
