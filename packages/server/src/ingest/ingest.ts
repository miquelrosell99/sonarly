import Database from 'better-sqlite3';
import type { Config } from '../config.js';

export interface IngestStats extends Record<string, number> {
  scanned: number;
  imported: number;
  failed: number;
}

export async function processIngestFolder(config: Config, db: Database.Database): Promise<IngestStats> {
  // TODO: implement ingest processing (moves files from INGEST_PATH into LIBRARY_PATH)
  return { scanned: 0, imported: 0, failed: 0 };
}
