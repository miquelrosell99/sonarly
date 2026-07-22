import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import { getUserByUsername } from '../users/index.js';
import { decryptSubsonicPassword } from './password.js';
import Database from 'better-sqlite3';

export function buildSubsonicToken(password: string, salt: string): string {
  return createHash('md5').update(password + salt).digest('hex');
}

export function verifySubsonicToken(db: Database.Database, username: string, token: string, salt: string, sessionSecret: string): string | null {
  const user = getUserByUsername(db, username);
  if (!user) return null;
  if (!user.subsonicPasswordEncrypted) return null;
  let decryptedPassword: string;
  try {
    decryptedPassword = decryptSubsonicPassword(user.subsonicPasswordEncrypted, sessionSecret);
  } catch {
    return null;
  }
  const expected = buildSubsonicToken(decryptedPassword, salt);
  try {
    if (cryptoTimingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) {
      return user.id;
    }
    return null;
  } catch {
    return null;
  }
}
