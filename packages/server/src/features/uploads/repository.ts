import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DuplicateStrategy } from '@sonarly/shared';

export interface UploadSession {
  id: string;
  libraryId: string;
  duplicateStrategy?: DuplicateStrategy;
  createdAt: string;
}

export function createUploadSession(
  db: Database.Database,
  libraryId: string,
  duplicateStrategy?: DuplicateStrategy,
): UploadSession {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO upload_sessions (id, library_id, duplicate_strategy, created_at) VALUES (?, ?, ?, ?)')
    .run(id, libraryId, duplicateStrategy ?? null, now);
  return { id, libraryId, duplicateStrategy, createdAt: now };
}

export function getUploadSession(db: Database.Database, id: string): UploadSession | undefined {
  const row = db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(id) as {
    id: string;
    library_id: string;
    duplicate_strategy: string | null;
    created_at: string;
  } | undefined;
  return row
    ? {
        id: row.id,
        libraryId: row.library_id,
        duplicateStrategy: (row.duplicate_strategy as DuplicateStrategy) ?? undefined,
        createdAt: row.created_at,
      }
    : undefined;
}

export function deleteUploadSession(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(id);
}
