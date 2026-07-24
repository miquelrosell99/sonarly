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

  it('returns defaults when no preferences exist', () => {
    const prefs = getUserPreferences(db, 'user-1');
    expect(prefs.hideExplicit).toBe(false);
    expect(prefs.blurExplicitTitles).toBe(false);
    expect(prefs.blurExplicitCovers).toBe(false);
  });

  it('updates and merges preferences', () => {
    updateUserPreferences(db, 'user-1', { hideExplicit: true });
    const prefs = getUserPreferences(db, 'user-1');
    expect(prefs.hideExplicit).toBe(true);
    expect(prefs.blurExplicitCovers).toBe(false);
  });

  it('merges subsequent updates without losing existing values', () => {
    updateUserPreferences(db, 'user-1', { hideExplicit: true });
    updateUserPreferences(db, 'user-1', { blurExplicitCovers: true });
    const prefs = getUserPreferences(db, 'user-1');
    expect(prefs.hideExplicit).toBe(true);
    expect(prefs.blurExplicitCovers).toBe(true);
  });
});
