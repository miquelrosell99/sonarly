import Database from 'better-sqlite3';
import { Config, getDbPath } from '../config.js';

export function getDb(config: Config): Database.Database {
  const db = new Database(getDbPath(config));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDb(): void {
  // No-op now that getDb returns a fresh connection per call.
  // Kept for backward compatibility with callers/tests.
}
