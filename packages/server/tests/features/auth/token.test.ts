import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildSubsonicToken, verifySubsonicToken } from '../../../src/features/auth/token.js';
import { encryptSubsonicPassword } from '../../../src/features/auth/password.js';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';

const SESSION_SECRET = 'a-secret-key-that-is-long-enough-for-the-session-secret-32';

describe('buildSubsonicToken', () => {
  it('produces MD5(password+salt)', () => {
    const token = buildSubsonicToken('secret', 'salt');
    expect(token).toHaveLength(32);
  });
});

describe('verifySubsonicToken', () => {
  it('verifies a token built from the plaintext password', () => {
    const db = new Database(':memory:');
    migrate(db);
    const password = 'supersecret';
    const salt = 'salty';
    const token = buildSubsonicToken(password, salt);
    const encrypted = encryptSubsonicPassword(password, SESSION_SECRET);
    createUser(db, { id: 'user-1', username: 'tester', passwordHash: 'ignored', subsonicPasswordEncrypted: encrypted, isAdmin: false, createdAt: new Date().toISOString() });

    expect(verifySubsonicToken(db, 'tester', token, salt, SESSION_SECRET)).toBe('user-1');
    expect(verifySubsonicToken(db, 'tester', 'bad', salt, SESSION_SECRET)).toBeNull();
    expect(verifySubsonicToken(db, 'missing', token, salt, SESSION_SECRET)).toBeNull();

    db.close();
  });

  it('returns false when the user has no subsonic credential', () => {
    const db = new Database(':memory:');
    migrate(db);
    createUser(db, { id: 'user-1', username: 'tester', passwordHash: 'ignored', subsonicPasswordEncrypted: '', isAdmin: false, createdAt: new Date().toISOString() });

    const token = buildSubsonicToken('supersecret', 'salty');
    expect(verifySubsonicToken(db, 'tester', token, 'salty', SESSION_SECRET)).toBeNull();

    db.close();
  });
});
