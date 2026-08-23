import Database from 'better-sqlite3';
import type { User, UpdateProfileInput, UpdateUserContentFiltersInput } from '@sonarly/shared';
import { deleteSessionsForUser } from '../auth/session.js';

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
  max_bitrate_kbps: number | null;
  transcode_format: string | null;
  hide_explicit: number;
  blur_explicit_titles: number;
  blur_explicit_covers: number;
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
    maxBitrateKbps: row.max_bitrate_kbps ?? undefined,
    transcodeFormat: (row.transcode_format as User['transcodeFormat']) ?? undefined,
    hideExplicit: row.hide_explicit === 1,
    blurExplicitTitles: row.blur_explicit_titles === 1,
    blurExplicitCovers: row.blur_explicit_covers === 1,
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
    'INSERT INTO users (id, username, password_hash, subsonic_password_encrypted, is_admin, name, surname, email, max_bitrate_kbps, transcode_format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    user.id,
    user.username,
    user.passwordHash,
    user.subsonicPasswordEncrypted,
    user.isAdmin ? 1 : 0,
    user.name ?? null,
    user.surname ?? null,
    user.email ?? null,
    user.maxBitrateKbps ?? null,
    user.transcodeFormat ?? null,
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

export function updateUserTranscoding(
  db: Database.Database,
  id: string,
  input: { maxBitrateKbps?: number; transcodeFormat?: User['transcodeFormat'] },
): void {
  db.prepare('UPDATE users SET max_bitrate_kbps = ?, transcode_format = ? WHERE id = ?').run(
    input.maxBitrateKbps ?? null,
    input.transcodeFormat ?? null,
    id,
  );
}

export function listUsers(db: Database.Database): User[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as DbUser[];
  return rows.map(toUser);
}

export function updateUserContentFilters(
  db: Database.Database,
  id: string,
  input: UpdateUserContentFiltersInput,
): void {
  const existing = getUserById(db, id);
  if (!existing) return;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.hideExplicit !== undefined) {
    updates.push('hide_explicit = ?');
    values.push(input.hideExplicit ? 1 : 0);
  }
  if (input.blurExplicitTitles !== undefined) {
    updates.push('blur_explicit_titles = ?');
    values.push(input.blurExplicitTitles ? 1 : 0);
  }
  if (input.blurExplicitCovers !== undefined) {
    updates.push('blur_explicit_covers = ?');
    values.push(input.blurExplicitCovers ? 1 : 0);
  }

  if (updates.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

export interface UpdateUserAdminInput {
  name?: string | null;
  surname?: string | null;
  email?: string | null;
  passwordHash?: string;
  subsonicPasswordEncrypted?: string;
}

export function updateUserAdminFields(
  db: Database.Database,
  id: string,
  input: UpdateUserAdminInput,
): void {
  const existing = getUserById(db, id);
  if (!existing) return;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name ?? null);
  }
  if (input.surname !== undefined) {
    updates.push('surname = ?');
    values.push(input.surname ?? null);
  }
  if (input.email !== undefined) {
    updates.push('email = ?');
    values.push(input.email ?? null);
  }
  if (input.passwordHash !== undefined) {
    updates.push('password_hash = ?');
    values.push(input.passwordHash);
  }
  if (input.subsonicPasswordEncrypted !== undefined) {
    updates.push('subsonic_password_encrypted = ?');
    values.push(input.subsonicPasswordEncrypted);
  }

  if (updates.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteUserById(db: Database.Database, id: string): void {
  const deleteUser = db.transaction(() => {
    // Drop the user's sessions first so a deleted user loses access immediately.
    deleteSessionsForUser(db, id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  deleteUser();
}
