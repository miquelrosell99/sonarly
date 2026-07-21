import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { getDbPath, type Config } from '../config.js';
import { migrate } from '../db/migrate.js';
import { scanLibrary } from './scanner.js';
import { popPendingJob, markJobRunning, markJobCompleted, markJobFailed } from './queue.js';
import { processIngestFolder } from '../ingest/ingest.js';

interface WorkerMessage {
  type: 'shutdown';
}

if (!parentPort) throw new Error('worker.ts must run inside a Worker');

const config = workerData as Config;
const db = new Database(getDbPath(config));
migrate(db);

let running = true;

async function loop(): Promise<void> {
  while (running) {
    const job = popPendingJob(db);
    if (!job) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    markJobRunning(db, job.id);
    try {
      if (job.type === 'scan' || job.type === 'resync') {
        const stats = await scanLibrary(config, db);
        markJobCompleted(db, job.id, stats);
      } else if (job.type === 'ingest') {
        const stats = await processIngestFolder(config, db);
        markJobCompleted(db, job.id, stats);
      }
    } catch (err) {
      markJobFailed(db, job.id, String(err));
    }
  }
}

parentPort.on('message', (msg: WorkerMessage) => {
  if (msg.type === 'shutdown') {
    running = false;
    db.close();
    process.exit(0);
  }
});

loop();
