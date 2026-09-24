import Database from 'better-sqlite3';
import { getUserLibraries } from './repository.js';

/**
 * Per-user library assignment is a security boundary: non-admin users only
 * see content in libraries assigned to them via user_libraries, admins see
 * everything, and songs with a NULL library_id are hidden from non-admins.
 */
export type LibraryScope =
  | { all: true }
  | { all: false; ids: string[] };

export interface ScopeUser {
  userId?: string;
  isAdmin?: boolean;
}

export function getLibraryScope(db: Database.Database, user: ScopeUser | undefined): LibraryScope {
  if (!user?.userId) {
    return { all: false, ids: [] };
  }
  if (user.isAdmin) {
    return { all: true };
  }
  return { all: false, ids: getUserLibraries(db, user.userId) };
}

export interface SqlCondition {
  sql: string;
  params: string[];
}

/**
 * Builds a parameterized `AND <column> IN (?, ...)` condition for the given
 * scope. `column` is always a hardcoded identifier at call sites (e.g.
 * 's.library_id'); only values are bound. Returns an empty condition for
 * admins. An empty scope yields a match-nothing condition, never
 * match-everything.
 */
export function libraryScopeCondition(scope: LibraryScope, column: string): SqlCondition {
  if (scope.all) {
    return { sql: '', params: [] };
  }
  if (scope.ids.length === 0) {
    return { sql: 'AND 0', params: [] };
  }
  return {
    sql: `AND ${column} IN (${scope.ids.map(() => '?').join(', ')})`,
    params: [...scope.ids],
  };
}

export function isSongInScope(db: Database.Database, scope: LibraryScope, songId: string): boolean {
  if (scope.all) return true;
  const condition = libraryScopeCondition(scope, 's.library_id');
  const row = db.prepare(`SELECT 1 FROM songs s WHERE s.id = ? ${condition.sql} LIMIT 1`)
    .get(songId, ...condition.params);
  return row !== undefined;
}

export function isAlbumInScope(db: Database.Database, scope: LibraryScope, albumId: string): boolean {
  if (scope.all) return true;
  const condition = libraryScopeCondition(scope, 's.library_id');
  const row = db.prepare(`
    SELECT 1 FROM songs s
    WHERE s.album_id = ? AND s.active = 1 ${condition.sql}
    LIMIT 1
  `).get(albumId, ...condition.params);
  return row !== undefined;
}

export function isArtistInScope(db: Database.Database, scope: LibraryScope, artistId: string): boolean {
  if (scope.all) return true;
  const condition = libraryScopeCondition(scope, 's.library_id');
  const row = db.prepare(`
    SELECT 1 FROM songs s
    WHERE s.artist_id = ? AND s.active = 1 ${condition.sql}
    LIMIT 1
  `).get(artistId, ...condition.params);
  return row !== undefined;
}

export function isCoverArtInScope(db: Database.Database, scope: LibraryScope, coverArtId: string): boolean {
  if (scope.all) return true;
  const condition = libraryScopeCondition(scope, 's.library_id');
  const row = db.prepare(`
    SELECT 1 FROM songs s
    LEFT JOIN albums al ON al.id = s.album_id
    WHERE s.active = 1 AND (s.cover_art_id = ? OR al.cover_art_id = ?) ${condition.sql}
    LIMIT 1
  `).get(coverArtId, coverArtId, ...condition.params);
  return row !== undefined;
}
