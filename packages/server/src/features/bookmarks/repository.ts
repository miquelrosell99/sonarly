import Database from 'better-sqlite3';

export interface Bookmark {
  userId: string;
  songId: string;
  position: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkRow {
  user_id: string;
  song_id: string;
  position: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export function getBookmarks(db: Database.Database, userId: string): Bookmark[] {
  const rows = db.prepare(`
    SELECT user_id, song_id, position, comment, created_at, updated_at
    FROM bookmarks
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(userId) as BookmarkRow[];

  return rows.map((row) => ({
    userId: row.user_id,
    songId: row.song_id,
    position: row.position,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function createBookmark(
  db: Database.Database,
  userId: string,
  songId: string,
  position: number,
  comment?: string,
): void {
  db.prepare(`
    INSERT INTO bookmarks (user_id, song_id, position, comment)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, song_id) DO UPDATE SET
      position = excluded.position,
      comment = excluded.comment,
      updated_at = datetime('now')
  `).run(userId, songId, position, comment ?? null);
}

export function deleteBookmark(
  db: Database.Database,
  userId: string,
  songId: string,
): boolean {
  const result = db.prepare(`
    DELETE FROM bookmarks WHERE user_id = ? AND song_id = ?
  `).run(userId, songId);
  return result.changes > 0;
}
