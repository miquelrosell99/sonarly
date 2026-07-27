import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { loadConfig, getDbPath } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { pushJob } from '../src/features/library/queue.js';

const config = loadConfig();
mkdirSync(config.DATA_DIR, { recursive: true });
const db = new Database(getDbPath(config));

try {
  migrate(db);
  pushJob(db, 'scan', config.LIBRARY_PATH);
  console.log(`Queued library scan for ${config.LIBRARY_PATH}`);
} finally {
  db.close();
}
