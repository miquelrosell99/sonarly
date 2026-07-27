import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import { getUserPreferences, updateUserPreferences } from '../../../src/features/user-preferences/repository.js';

describe('user preferences repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    createUser(db, {
      id: 'user-1',
      username: 'user',
      passwordHash: 'hash',
      subsonicPasswordEncrypted: 'encrypted',
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty preferences when none exist', () => {
    const prefs = getUserPreferences(db, 'user-1');
    expect(prefs).toEqual({});
  });

  it('updates and merges preferences', () => {
    updateUserPreferences(db, 'user-1', { themeMode: 'dark' });
    const prefs = getUserPreferences(db, 'user-1');
    expect(prefs.themeMode).toBe('dark');
    expect(prefs.accentColor).toBeUndefined();
  });

  it('merges subsequent updates without losing existing values', () => {
    updateUserPreferences(db, 'user-1', { themeMode: 'dark' });
    updateUserPreferences(db, 'user-1', { accentColor: 'cyan' });
    const prefs = getUserPreferences(db, 'user-1');
    expect(prefs.themeMode).toBe('dark');
    expect(prefs.accentColor).toBe('cyan');
  });
});
