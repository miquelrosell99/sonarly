import Database from 'better-sqlite3';
import type { UserPreferences } from '@sonarly/shared';
import { DEFAULT_USER_PREFERENCES } from '@sonarly/shared';

export function getUserPreferences(db: Database.Database, userId: string): UserPreferences {
  const row = db.prepare('SELECT preferences FROM user_preferences WHERE user_id = ?').get(userId) as { preferences: string } | undefined;
  if (!row) return { ...DEFAULT_USER_PREFERENCES };
  try {
    const parsed = JSON.parse(row.preferences) as UserPreferences;
    return { ...DEFAULT_USER_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_USER_PREFERENCES };
  }
}

export function updateUserPreferences(db: Database.Database, userId: string, preferences: Partial<UserPreferences>): UserPreferences {
  const existing = getUserPreferences(db, userId);
  const merged = { ...existing, ...preferences };
  db.prepare(`
    INSERT INTO user_preferences (user_id, preferences, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      preferences = excluded.preferences,
      updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(merged));
  return merged;
}
