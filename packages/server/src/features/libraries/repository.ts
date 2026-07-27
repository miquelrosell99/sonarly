import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Library, CreateLibraryInput, UpdateLibraryInput } from '@sonarly/shared';
import { getSetting } from '../settings/index.js';

interface DbLibrary {
  id: string;
  name: string;
  path: string;
  organize_pattern: string;
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

export function createLibrary(db: Database.Database, library: Library): void {
  db.prepare('INSERT INTO libraries (id, name, path, organize_pattern, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    library.id,
    library.name,
    library.path,
    library.organizePattern,
    library.createdAt,
    library.updatedAt,
  );
}

export function updateLibrary(db: Database.Database, id: string, input: UpdateLibraryInput): void {
  const existing = getLibraryById(db, id);
  if (!existing) return;
  db.prepare('UPDATE libraries SET name = ?, path = ?, organize_pattern = ?, updated_at = ? WHERE id = ?').run(
    input.name ?? existing.name,
    input.path ?? existing.path,
    input.organizePattern ?? existing.organizePattern,
    new Date().toISOString(),
    id,
  );
}

export function deleteLibraryById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM libraries WHERE id = ?').run(id);
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
    createdAt: now,
    updatedAt: now,
  });
}
