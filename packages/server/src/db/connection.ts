import Database from 'better-sqlite3';
import { Config, getDbPath } from '../config.js';

let db: Database.Database | undefined;

export function getDb(config: Config): Database.Database {
  if (!db) {
    db = new Database(getDbPath(config));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Avoid SQLITE_BUSY races with the scanner worker connection.
    db.pragma('busy_timeout = 5000');
    db.pragma('optimize');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
