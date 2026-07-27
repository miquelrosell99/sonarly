import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Library, CreateLibraryInput, UpdateLibraryInput } from '@sonarly/shared';

interface DbLibrary {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

function toLibrary(row: DbLibrary): Library {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  db.prepare('INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    library.id,
    library.name,
    library.path,
    library.createdAt,
    library.updatedAt,
  );
}

export function updateLibrary(db: Database.Database, id: string, input: UpdateLibraryInput): void {
  const existing = getLibraryById(db, id);
  if (!existing) return;
  db.prepare('UPDATE libraries SET name = ?, path = ?, updated_at = ? WHERE id = ?').run(
    input.name ?? existing.name,
    input.path ?? existing.path,
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
    createdAt: now,
    updatedAt: now,
  });
}
