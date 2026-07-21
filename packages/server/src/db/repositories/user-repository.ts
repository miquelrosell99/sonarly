import Database from 'better-sqlite3';
import type { User } from '@sonarly/shared';

export interface DbUser {
  id: string;
  username: string;
  password_hash: string;
  subsonic_password_encrypted: string | null;
  is_admin: number;
  created_at: string;
}

function toUser(row: DbUser): User {
  return {
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.is_admin),
    createdAt: row.created_at,
  };
}

export function getUserById(db: Database.Database, id: string): User | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
  return row ? toUser(row) : undefined;
}

export function getUserByUsername(
  db: Database.Database,
  username: string,
): (User & { passwordHash: string; subsonicPasswordEncrypted: string }) | undefined {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as DbUser | undefined;
  if (!row) return undefined;
  return {
    ...toUser(row),
    passwordHash: row.password_hash,
    subsonicPasswordEncrypted: row.subsonic_password_encrypted ?? '',
  };
}

export function createUser(db: Database.Database, user: User & { passwordHash: string; subsonicPasswordEncrypted: string }): void {
  db.prepare('INSERT INTO users (id, username, password_hash, subsonic_password_encrypted, is_admin) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, user.username, user.passwordHash, user.subsonicPasswordEncrypted, user.isAdmin ? 1 : 0);
}
