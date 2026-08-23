import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { getDbPath, type Config } from '../../config.js';
import { migrate } from '../../db/migrate.js';
import { scanLibrary } from './scanner.js';
import { popPendingJob, pushJob, markJobRunning, markJobCompleted, markJobFailed, pruneScanJobs, failStaleRunningJobs } from './queue.js';
import { processIngestFolder, cleanupAllReviewFolders, runOrganizeJob } from '../ingest/index.js';
import {
  getReviewRetentionDays,
  getSetting,
  setSetting,
} from '../settings/index.js';
import { ScanScheduler, ArtistImageScheduler, IngestScheduler } from './scheduler.js';
import { syncMissingArtistImages, syncMissingArtistMetadata } from '../artists/index.js';
import { ensureDefaultLibrary, getLibraryById } from '../libraries/index.js';
import { registerDefaultWriters } from '../tags/index.js';
import type { DuplicateStrategy } from '@sonarly/shared';

registerDefaultWriters();

interface WorkerMessage {
  type: 'shutdown';
}

interface JobCompletedMessage {
  type: 'job:completed';
  jobType: string;
  runId: string;
  stats: Record<string, unknown>;
}

function notifyJobCompleted(jobType: string, runId: string, stats: Record<string, unknown>): void {
  if (!parentPort) return;
  const message: JobCompletedMessage = { type: 'job:completed', jobType, runId, stats };
  parentPort.postMessage(message);
}

if (!parentPort) throw new Error('worker.ts must run inside a Worker');

const config = workerData as Config;
const db = new Database(getDbPath(config));
// Match the main connection pragmas so the worker does not hit SQLITE_BUSY
// races and enforces the same constraints.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
migrate(db);
ensureDefaultLibrary(db, config.LIBRARY_PATH);
// A previous worker may have died mid-job; sweep stale 'running' rows.
failStaleRunningJobs(db);

let running = true;
let activeJobId: string | null = null;
let shutdownJobId: string | null = null;
let nextReviewCleanupAttempt = 0;
const REVIEW_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REVIEW_CLEANUP_RETRY_MS = 5 * 60 * 1000;

const scanScheduler = new ScanScheduler(config);
const artistImageScheduler = new ArtistImageScheduler(config);
const ingestScheduler = new IngestScheduler(config);

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
    ingestScheduler.tick(db);

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
        notifyJobCompleted(job.type, job.id, stats);
      } else if (job.type === 'ingest') {
        let payload: { sourcePath?: string; libraryId?: string; duplicateStrategy?: DuplicateStrategy } = {};
        try {
          payload = JSON.parse(job.payload || '{}');
        } catch {
          payload = {};
        }
        const library = payload.libraryId ? getLibraryById(db, payload.libraryId) : undefined;
        const stats = await processIngestFolder(config, db, payload.sourcePath, library, {
          duplicateStrategy: payload.duplicateStrategy,
          runId: job.id,
        });
        markJobCompleted(db, job.id, stats);
        notifyJobCompleted(job.type, job.id, stats);
      } else if (job.type === 'cleanup_review') {
        const retentionDays = getReviewRetentionDays(db, config.REVIEW_RETENTION_DAYS);
        const stats = await cleanupAllReviewFolders(config.INGEST_PATH, retentionDays);
        markJobCompleted(db, job.id, stats);
        setSetting(db, 'last_review_cleanup', new Date().toISOString());
        notifyJobCompleted(job.type, job.id, stats);
      } else if (job.type === 'organize') {
        const stats = await runOrganizeJob(config, db, job.id);
        markJobCompleted(db, job.id, stats);
        notifyJobCompleted(job.type, job.id, stats);
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
        const stats = {
          scanned: imageStats.scanned + metadataStats.scanned,
          updated: imageStats.updated + metadataStats.updated,
          failed: imageStats.failed + metadataStats.failed,
        };
        markJobCompleted(db, job.id, stats);
        notifyJobCompleted(job.type, job.id, stats);
      }
    } catch (err) {
      markJobFailed(db, job.id, String(err));
      notifyJobCompleted(job.type, job.id, { failed: 1, error: String(err) });
    } finally {
      activeJobId = null;
    }
    pruneScanJobs(db);
  }

  if (shutdownJobId) {
    // Only mark the job failed if it never reached a terminal state; a job
    // that completed just before shutdown must not be clobbered.
    const row = db.prepare('SELECT status FROM scan_jobs WHERE id = ?').get(shutdownJobId) as { status: string } | undefined;
    if (row && row.status !== 'completed' && row.status !== 'failed') {
      markJobFailed(db, shutdownJobId, 'Worker shut down while job was running');
    }
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

loop().catch((err) => {
  // Exit non-zero so the parent process notices and respawns the worker.
  console.error('Library worker loop crashed', err);
  try {
    db.close();
  } catch {
    // Ignore cleanup errors.
  }
  process.exit(1);
});
