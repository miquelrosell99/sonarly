import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import { getUserByUsername } from '../db/repositories/user-repository.js';
import { decryptSubsonicPassword } from './password.js';
import Database from 'better-sqlite3';

export function buildSubsonicToken(password: string, salt: string): string {
  return createHash('md5').update(password + salt).digest('hex');
}

export function verifySubsonicToken(db: Database.Database, username: string, token: string, salt: string, sessionSecret: string): boolean {
  const user = getUserByUsername(db, username);
  if (!user) return false;
  if (!user.subsonicPasswordEncrypted) return false;
  let decryptedPassword: string;
  try {
    decryptedPassword = decryptSubsonicPassword(user.subsonicPasswordEncrypted, sessionSecret);
  } catch {
    return false;
  }
  const expected = buildSubsonicToken(decryptedPassword, salt);
  try {
    return cryptoTimingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
