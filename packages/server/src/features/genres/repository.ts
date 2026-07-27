import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Album } from '@sonarly/shared';
import { DbAlbum, toAlbum } from '../albums/repository.js';

export interface Genre {
  id: string;
  name: string;
  parentId?: string;
  active: boolean;
}

interface DbGenre {
  id: string;
  name: string;
  parent_id: string | null;
  active: number;
}

function toGenre(row: DbGenre): Genre {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? undefined,
    active: row.active === 1,
  };
}

export function listGenres(db: Database.Database): Genre[] {
  const rows = db.prepare('SELECT * FROM genres WHERE active = 1 ORDER BY name').all() as DbGenre[];
  return rows.map(toGenre);
}

export function getGenreById(db: Database.Database, id: string): Genre | undefined {
  const row = db.prepare('SELECT * FROM genres WHERE id = ?').get(id) as DbGenre | undefined;
  return row ? toGenre(row) : undefined;
}

export function getGenreByName(db: Database.Database, name: string): Genre | undefined {
  const row = db.prepare('SELECT * FROM genres WHERE name = ? COLLATE NOCASE').get(name) as DbGenre | undefined;
  return row ? toGenre(row) : undefined;
}

export function getGenreNameById(db: Database.Database, id: string): string | undefined {
  const row = db.prepare('SELECT name FROM genres WHERE id = ?').get(id) as { name: string } | undefined;
  return row?.name;
}

export function createGenre(db: Database.Database, name: string, parentId?: string): Genre {
  const id = randomUUID();
  db.prepare('INSERT INTO genres (id, name, parent_id, active) VALUES (?, ?, ?, 1)').run(
    id,
    name.trim(),
    parentId ?? null,
  );
  return { id, name: name.trim(), parentId, active: true };
}

export function getOrCreateGenreByName(db: Database.Database, name: string, parentId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Genre name cannot be empty');
  }
  const existing = getGenreByName(db, trimmed);
  if (existing) return existing.id;
  return createGenre(db, trimmed, parentId).id;
}

export function updateGenre(db: Database.Database, id: string, changes: { name?: string; parentId?: string | null; active?: boolean }): void {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (changes.name !== undefined) {
    sets.push('name = ?');
    params.push(changes.name.trim());
  }
  if (changes.parentId !== undefined) {
    sets.push('parent_id = ?');
    params.push(changes.parentId ?? null);
  }
  if (changes.active !== undefined) {
    sets.push('active = ?');
    params.push(changes.active ? 1 : 0);
  }
  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE genres SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteGenre(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM genres WHERE id = ?').run(id);
}

export function resolveGenreNameToId(db: Database.Database, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Genre name cannot be empty');
  }
  const paths = buildGenrePaths(db);
  for (const [id, path] of paths.entries()) {
    if (path.toLowerCase() === trimmed.toLowerCase()) {
      return id;
    }
  }
  return getOrCreateGenreByName(db, trimmed);
}

export function buildGenrePaths(db: Database.Database): Map<string, string> {
  const rows = db.prepare('SELECT id, name, parent_id FROM genres WHERE active = 1').all() as DbGenre[];
  const byId = new Map<string, DbGenre>();
  for (const row of rows) {
    byId.set(row.id, row);
  }

  const paths = new Map<string, string>();
  for (const row of rows) {
    const parts: string[] = [];
    let current: DbGenre | undefined = row;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      parts.unshift(current.name);
      visited.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    paths.set(row.id, parts.join(' > '));
  }
  return paths;
}

export function updateGenreNameCache(db: Database.Database, genreId: string): void {
  const name = getGenreNameById(db, genreId);
  if (!name) return;
  db.prepare('UPDATE songs SET genre = ? WHERE genre_id = ? AND active = 1').run(name, genreId);
  db.prepare('UPDATE albums SET genre = ? WHERE genre_id = ? AND active = 1').run(name, genreId);
}

function findExistingGenreByPathOrName(
  db: Database.Database,
  genre: string,
): { id: string; name: string } | undefined {
  const trimmed = genre.trim();
  if (!trimmed) return undefined;

  const paths = buildGenrePaths(db);
  for (const [id, path] of paths.entries()) {
    if (path === trimmed) {
      return { id, name: getGenreNameById(db, id) ?? trimmed };
    }
  }

  const existing = getGenreByName(db, trimmed);
  if (existing) {
    return { id: existing.id, name: existing.name };
  }

  return undefined;
}

export function resolveGenreForTagWrite(
  db: Database.Database,
  genre: string,
): { id: string; name: string } {
  const existing = findExistingGenreByPathOrName(db, genre);
  if (existing) return existing;

  const id = getOrCreateGenreByName(db, genre);
  return { id, name: getGenreNameById(db, id) ?? genre.trim() };
}

export function resolveGenreForFilter(
  db: Database.Database,
  genre: string,
): { id: string; name: string } | undefined {
  return findExistingGenreByPathOrName(db, genre);
}

export function setSongGenres(
  db: Database.Database,
  songId: string,
  genreIds: string[],
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM song_genres WHERE song_id = ?').run(songId);
    const insert = db.prepare(
      'INSERT INTO song_genres (song_id, genre_id, position) VALUES (?, ?, ?)'
    );
    for (const [position, genreId] of genreIds.entries()) {
      insert.run(songId, genreId, position);
    }
  })();
}

export function getSongGenreNames(db: Database.Database, songId: string): string[] {
  return db.prepare(`
    SELECT g.name
    FROM song_genres sg
    JOIN genres g ON g.id = sg.genre_id
    WHERE sg.song_id = ?
    ORDER BY sg.position
  `).pluck().all(songId) as string[];
}

export function getSongGenreNamesForMany(
  db: Database.Database,
  songIds: string[],
): Map<string, string[]> {
  if (songIds.length === 0) return new Map();
  const placeholders = songIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT sg.song_id, g.name
    FROM song_genres sg
    JOIN genres g ON g.id = sg.genre_id
    WHERE sg.song_id IN (${placeholders})
    ORDER BY sg.song_id, sg.position
  `).all(...songIds) as { song_id: string; name: string }[];
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.song_id) ?? [];
    list.push(row.name);
    map.set(row.song_id, list);
  }
  return map;
}

export function setAlbumGenres(
  db: Database.Database,
  albumId: string,
  genreIds: string[],
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM album_genres WHERE album_id = ?').run(albumId);
    const insert = db.prepare(
      'INSERT INTO album_genres (album_id, genre_id, position) VALUES (?, ?, ?)'
    );
    for (const [position, genreId] of genreIds.entries()) {
      insert.run(albumId, genreId, position);
    }
  })();
}

export function getAlbumGenreNames(db: Database.Database, albumId: string): string[] {
  return db.prepare(`
    SELECT g.name
    FROM album_genres ag
    JOIN genres g ON g.id = ag.genre_id
    WHERE ag.album_id = ?
    ORDER BY ag.position
  `).pluck().all(albumId) as string[];
}

export function getAlbumGenreNamesForMany(
  db: Database.Database,
  albumIds: string[],
): Map<string, string[]> {
  if (albumIds.length === 0) return new Map();
  const placeholders = albumIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ag.album_id, g.name
    FROM album_genres ag
    JOIN genres g ON g.id = ag.genre_id
    WHERE ag.album_id IN (${placeholders})
    ORDER BY ag.album_id, ag.position
  `).all(...albumIds) as { album_id: string; name: string }[];
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.album_id) ?? [];
    list.push(row.name);
    map.set(row.album_id, list);
  }
  return map;
}

export function getOrCreateGenreIdsByNames(
  db: Database.Database,
  names: string[],
): string[] {
  return names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => getOrCreateGenreByName(db, name));
}

export function getRandomAlbumsByGenre(
  db: Database.Database,
  genreId: string,
  limit: number,
  hideExplicit: boolean,
  libraryId?: string,
): Album[] {
  const explicitHaving = hideExplicit
    ? 'HAVING SUM(CASE WHEN s.explicit = 0 THEN 1 ELSE 0 END) > 0'
    : '';
  const libraryFilter = libraryId ? 'AND s.library_id = ?' : '';
  const libraryParams = libraryId ? [libraryId] : [];
  const rows = db.prepare(`
    SELECT a.*
    FROM albums a
    JOIN album_genres ag ON ag.album_id = a.id
    LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1 ${libraryFilter}
    WHERE a.active = 1 AND ag.genre_id = ?
    GROUP BY a.id
    ${explicitHaving}
    ORDER BY RANDOM()
    LIMIT ?
  `).all(...libraryParams, genreId, limit) as DbAlbum[];
  return rows.map(toAlbum);
}

export function getGenreIdsForLibrary(db: Database.Database, libraryId: string): Set<string> {
  const rows = db.prepare(`
    SELECT DISTINCT sg.genre_id AS id
    FROM song_genres sg
    JOIN songs s ON s.id = sg.song_id
    WHERE s.active = 1 AND s.library_id = ?
    UNION
    SELECT DISTINCT ag.genre_id AS id
    FROM album_genres ag
    JOIN songs s ON s.album_id = ag.album_id
    WHERE s.active = 1 AND s.library_id = ?
  `).all(libraryId, libraryId) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}
