import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Library, CreateLibraryInput, UpdateLibraryInput } from '@sonarly/shared';
import { getSetting } from '../settings/index.js';

interface DbLibrary {
  id: string;
  name: string;
  path: string;
  organize_pattern: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_ORGANIZE_PATTERN = '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}';

function toLibrary(row: DbLibrary): Library {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    organizePattern: row.organize_pattern,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getDefaultOrganizePattern(db: Database.Database): string {
  return getSetting(db, 'organize_pattern', DEFAULT_ORGANIZE_PATTERN);
}

export function listLibraries(db: Database.Database): Library[] {
  const rows = db.prepare('SELECT * FROM libraries ORDER BY name').all() as DbLibrary[];
  return rows.map(toLibrary);
}

export function getLibraryById(db: Database.Database, id: string): Library | undefined {
  const row = db.prepare('SELECT * FROM libraries WHERE id = ?').get(id) as DbLibrary | undefined;
  return row ? toLibrary(row) : undefined;
}

export function getDefaultLibrary(db: Database.Database): Library | undefined {
  const row = db.prepare('SELECT * FROM libraries WHERE is_default = 1 LIMIT 1').get() as DbLibrary | undefined;
  return row ? toLibrary(row) : undefined;
}

function clearDefaultExcept(db: Database.Database, id?: string): void {
  if (id) {
    db.prepare('UPDATE libraries SET is_default = 0 WHERE id != ?').run(id);
  } else {
    db.prepare('UPDATE libraries SET is_default = 0').run();
  }
}

export function createLibrary(db: Database.Database, library: Library): void {
  const count = (db.prepare('SELECT COUNT(*) AS count FROM libraries').get() as { count: number }).count;
  const isDefault = (count === 0 || library.isDefault) ? 1 : 0;
  db.prepare(
    'INSERT INTO libraries (id, name, path, organize_pattern, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    library.id,
    library.name,
    library.path,
    library.organizePattern,
    isDefault,
    library.createdAt,
    library.updatedAt,
  );
  if (isDefault) {
    clearDefaultExcept(db, library.id);
  }
}

export function updateLibrary(db: Database.Database, id: string, input: UpdateLibraryInput): void {
  const existing = getLibraryById(db, id);
  if (!existing) return;
  const isDefault = input.isDefault ?? existing.isDefault;
  db.prepare(
    'UPDATE libraries SET name = ?, path = ?, organize_pattern = ?, is_default = ?, updated_at = ? WHERE id = ?'
  ).run(
    input.name ?? existing.name,
    input.path ?? existing.path,
    input.organizePattern ?? existing.organizePattern,
    isDefault ? 1 : 0,
    new Date().toISOString(),
    id,
  );
  if (isDefault) {
    clearDefaultExcept(db, id);
  }
}

export function deleteLibraryById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM libraries WHERE id = ?').run(id);
}

export function getLibraryUsers(db: Database.Database, libraryId: string): string[] {
  return db.prepare('SELECT user_id FROM user_libraries WHERE library_id = ? ORDER BY user_id')
    .pluck().all(libraryId) as string[];
}

export function assignUsersToLibrary(db: Database.Database, libraryId: string, userIds: string[]): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO user_libraries (user_id, library_id) VALUES (?, ?)');
  for (const userId of userIds) {
    stmt.run(userId, libraryId);
  }
}

export function removeUserFromLibrary(db: Database.Database, libraryId: string, userId: string): void {
  db.prepare('DELETE FROM user_libraries WHERE library_id = ? AND user_id = ?').run(libraryId, userId);
}

export function ensureDefaultLibrary(db: Database.Database, path: string): void {
  const count = (db.prepare('SELECT COUNT(*) AS count FROM libraries').get() as { count: number }).count;
  if (count > 0) return;
  const now = new Date().toISOString();
  const name = path.split('/').filter(Boolean).pop() || 'Library';
  createLibrary(db, {
    id: randomUUID(),
    name,
    path,
    organizePattern: getDefaultOrganizePattern(db),
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
}
