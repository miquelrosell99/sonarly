import { randomBytes, createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export function generateApiKey(): string {
  return 'sk_' + randomBytes(32).toString('hex');
}

export function storeApiKey(db: Database.Database, userId: string, key: string): void {
  db.prepare('INSERT INTO api_keys (id, user_id, key_hash) VALUES (?, ?, ?)')
    .run(randomUUID(), userId, hashKey(key));
}

export function verifyApiKey(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT user_id FROM api_keys WHERE key_hash = ?').get(hashKey(key)) as { user_id: string } | undefined;
  return row?.user_id;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
