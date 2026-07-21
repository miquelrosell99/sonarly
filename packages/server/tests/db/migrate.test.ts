import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';

describe('migrate', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('runs migrations and records them', () => {
    migrate(db);
    const filenames = db.prepare('SELECT filename FROM migrations ORDER BY filename').pluck().all() as string[];
    expect(filenames.length).toBeGreaterThan(0);
    expect(filenames).toContain('001_initial.sql');
  });

  it('is idempotent and can be resumed', () => {
    migrate(db);
    const firstRun = db.prepare('SELECT filename FROM migrations ORDER BY filename').pluck().all() as string[];

    migrate(db);
    const secondRun = db.prepare('SELECT filename FROM migrations ORDER BY filename').pluck().all() as string[];

    expect(secondRun).toEqual(firstRun);
  });
});
