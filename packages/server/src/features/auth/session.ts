import type { SessionStore } from '@fastify/session';
import Database from 'better-sqlite3';

export interface SessionData {
  userId: string;
  username: string;
  isAdmin: boolean;
}

export function deleteSessionsForUser(db: Database.Database, userId: string): void {
  const rows = db.prepare('SELECT sid, sess FROM sessions').all() as { sid: string; sess: string }[];
  const del = db.prepare('DELETE FROM sessions WHERE sid = ?');
  for (const row of rows) {
    try {
      const sess = JSON.parse(row.sess);
      if (sess?.userId === userId) del.run(row.sid);
    } catch {
      // Ignore malformed session payloads.
    }
  }
}

export function sweepExpiredSessions(db: Database.Database): void {
  db.prepare('DELETE FROM sessions WHERE expire <= ?').run(new Date().toISOString());
}

export function createSessionStore(db: Database.Database): SessionStore {
  const get = (sid: string, callback: (err: Error | null, session?: any) => void) => {
    try {
      // expire is stored as ISO 8601 text; compare against an ISO 8601 "now"
      // so the string comparison is consistent ('T' vs ' ' in datetime('now')
      // would otherwise keep expired sessions alive).
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, new Date().toISOString()) as any;
      callback(null, row ? JSON.parse(row.sess) : undefined);
    } catch (err) {
      callback(err as Error);
    }
  };

  const set = (sid: string, session: any, callback: (err?: Error) => void) => {
    try {
      const expire = new Date(Date.now() + (session.cookie?.maxAge || 86400000));
      db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire')
        .run(sid, JSON.stringify(session), expire.toISOString());
      callback();
    } catch (err) {
      callback(err as Error);
    }
  };

  const destroy = (sid: string, callback: (err?: Error) => void) => {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback();
    } catch (err) {
      callback(err as Error);
    }
  };

  return { get, set, destroy };
}
