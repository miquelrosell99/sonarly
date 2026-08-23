import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

export function verifyApiKey(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT user_id FROM api_keys WHERE key_hash = ?').get(hashKey(key)) as { user_id: string } | undefined;
  return row?.user_id;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
