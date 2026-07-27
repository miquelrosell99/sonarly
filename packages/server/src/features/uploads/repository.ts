import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface UploadSession {
  id: string;
  libraryId: string;
  createdAt: string;
}

export function createUploadSession(db: Database.Database, libraryId: string): UploadSession {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO upload_sessions (id, library_id, created_at) VALUES (?, ?, ?)').run(id, libraryId, now);
  return { id, libraryId, createdAt: now };
}

export function getUploadSession(db: Database.Database, id: string): UploadSession | undefined {
  const row = db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(id) as { id: string; library_id: string; created_at: string } | undefined;
  return row ? { id: row.id, libraryId: row.library_id, createdAt: row.created_at } : undefined;
}

export function deleteUploadSession(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(id);
}
