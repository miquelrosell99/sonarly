import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import { getUserByUsername } from '../db/repositories/user-repository.js';
import Database from 'better-sqlite3';

export function buildSubsonicToken(password: string, salt: string): string {
  return createHash('md5').update(password + salt).digest('hex');
}

export function verifySubsonicToken(db: Database.Database, username: string, token: string, salt: string): boolean {
  const user = getUserByUsername(db, username);
  if (!user) return false;
  const expected = buildSubsonicToken(user.subsonicPasswordHash, salt);
  try {
    return cryptoTimingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
