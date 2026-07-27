import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getDbPath, type Config } from '../../config.js';
import { migrate } from '../../db/migrate.js';
import { scanLibrary } from './scanner.js';
import { popPendingJob, pushJob, markJobRunning, markJobCompleted, markJobFailed } from './queue.js';
import { processIngestFolder, cleanupReviewFolder, runOrganizeJob } from '../ingest/index.js';
import {
  getReviewRetentionDays,
  getSetting,
  setSetting,
} from '../settings/index.js';
import { ScanScheduler, ArtistImageScheduler } from './scheduler.js';
import { syncMissingArtistImages, syncMissingArtistMetadata } from '../artists/index.js';
import { ensureDefaultLibrary } from '../libraries/index.js';
import { registerDefaultWriters } from '../tags/index.js';

registerDefaultWriters();

interface WorkerMessage {
  type: 'shutdown';
}

if (!parentPort) throw new Error('worker.ts must run inside a Worker');

const config = workerData as Config;
const db = new Database(getDbPath(config));
migrate(db);
ensureDefaultLibrary(db, config.LIBRARY_PATH);

let running = true;
let activeJobId: string | null = null;
let shutdownJobId: string | null = null;
let nextReviewCleanupAttempt = 0;
const REVIEW_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REVIEW_CLEANUP_RETRY_MS = 5 * 60 * 1000;

const scanScheduler = new ScanScheduler(config);
const artistImageScheduler = new ArtistImageScheduler(config);

function hasPendingOrRunningReviewCleanup(): boolean {
  const row = db.prepare(
    "SELECT 1 FROM scan_jobs WHERE type = 'cleanup_review' AND status IN ('pending', 'running') LIMIT 1"
  ).get();
  return row !== undefined;
}

function scheduleReviewCleanupIfNeeded(): void {
  const now = Date.now();
  if (now < nextReviewCleanupAttempt) return;

  const lastRaw = getSetting(db, 'last_review_cleanup', '');
  const last = lastRaw ? new Date(lastRaw).getTime() : 0;
  if (now - last < REVIEW_CLEANUP_INTERVAL_MS) return;
  if (hasPendingOrRunningReviewCleanup()) return;

  pushJob(db, 'cleanup_review', '');
  nextReviewCleanupAttempt = now + REVIEW_CLEANUP_RETRY_MS;
}

async function loop(): Promise<void> {
  while (running) {
    scheduleReviewCleanupIfNeeded();
    scanScheduler.tick(db);
    artistImageScheduler.tick(db);

    const job = popPendingJob(db);
    if (!job) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    activeJobId = job.id;
    markJobRunning(db, job.id);
    try {
      if (job.type === 'scan' || job.type === 'resync') {
        const stats = await scanLibrary(config, db);
        markJobCompleted(db, job.id, stats);
      } else if (job.type === 'ingest') {
        const stats = await processIngestFolder(config, db);
        markJobCompleted(db, job.id, stats);
      } else if (job.type === 'cleanup_review') {
        const retentionDays = getReviewRetentionDays(db, config.REVIEW_RETENTION_DAYS);
        const reviewDir = join(config.INGEST_PATH, 'review');
        const stats = await cleanupReviewFolder(reviewDir, retentionDays);
        markJobCompleted(db, job.id, stats);
        setSetting(db, 'last_review_cleanup', new Date().toISOString());
      } else if (job.type === 'organize') {
        const stats = await runOrganizeJob(config, db, job.id);
        markJobCompleted(db, job.id, stats);
      } else if (job.type === 'artist_images') {
        let options: { refetchExisting?: boolean } = {};
        try {
          options = JSON.parse(job.payload || '{}');
        } catch {
          options = {};
        }
        const refetch = options.refetchExisting === true;
        const imageStats = await syncMissingArtistImages(db, config.DATA_DIR, {
          refetchExisting: refetch,
        });
        const metadataStats = await syncMissingArtistMetadata(db, {
          refetchExisting: refetch,
        });
        markJobCompleted(db, job.id, {
          scanned: imageStats.scanned + metadataStats.scanned,
          updated: imageStats.updated + metadataStats.updated,
          failed: imageStats.failed + metadataStats.failed,
        });
      }
    } catch (err) {
      markJobFailed(db, job.id, String(err));
    } finally {
      activeJobId = null;
    }
  }

  if (shutdownJobId) {
    markJobFailed(db, shutdownJobId, 'Worker shut down while job was running');
  }
  db.close();
  process.exit(0);
}

parentPort.on('message', (msg: WorkerMessage) => {
  if (msg.type === 'shutdown') {
    running = false;
    if (activeJobId) {
      shutdownJobId = activeJobId;
    }
  }
});

loop();
