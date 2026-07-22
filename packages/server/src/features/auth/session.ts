import type { SessionStore } from '@fastify/session';
import Database from 'better-sqlite3';

export interface SessionData {
  userId: string;
  username: string;
  isAdmin: boolean;
}

export function createSessionStore(db: Database.Database): SessionStore {
  const get = (sid: string, callback: (err: Error | null, session?: any) => void) => {
    try {
      const row = db.prepare("SELECT sess FROM sessions WHERE sid = ? AND expire > datetime('now')").get(sid) as any;
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
