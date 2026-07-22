import Database from 'better-sqlite3';
import type { User, UpdateProfileInput } from '@sonarly/shared';

export interface DbUser {
  id: string;
  username: string;
  password_hash: string;
  subsonic_password_encrypted: string | null;
  is_admin: number;
  created_at: string;
  name: string | null;
  surname: string | null;
  email: string | null;
  avatar_path: string | null;
}

function toUser(row: DbUser): User {
  return {
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.is_admin),
    createdAt: row.created_at,
    name: row.name ?? undefined,
    surname: row.surname ?? undefined,
    email: row.email ?? undefined,
    avatarUrl: row.avatar_path ?? undefined,
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

export function createUser(
  db: Database.Database,
  user: User & { passwordHash: string; subsonicPasswordEncrypted: string },
): void {
  db.prepare(
    'INSERT INTO users (id, username, password_hash, subsonic_password_encrypted, is_admin, name, surname, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    user.id,
    user.username,
    user.passwordHash,
    user.subsonicPasswordEncrypted,
    user.isAdmin ? 1 : 0,
    user.name ?? null,
    user.surname ?? null,
    user.email ?? null,
  );
}

export function updateProfile(db: Database.Database, id: string, input: UpdateProfileInput): void {
  db.prepare('UPDATE users SET name = ?, surname = ?, email = ? WHERE id = ?').run(
    input.name ?? null,
    input.surname ?? null,
    input.email ?? null,
    id,
  );
}

export function updateAvatar(db: Database.Database, id: string, avatarPath: string | null): void {
  db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(avatarPath, id);
}

export function listUsers(db: Database.Database): User[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as DbUser[];
  return rows.map(toUser);
}
