import Database from 'better-sqlite3';
import type { Album } from '@sonarly/shared';

export interface DbAlbum {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  year: number | null;
  genre: string | null;
  cover_art_id: string | null;
  active: number;
}

function toAlbum(row: DbAlbum): Album {
  return {
    id: row.id,
    name: row.name,
    artistId: row.artist_id ?? undefined,
    artistName: row.artist_name ?? undefined,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    coverArt: row.cover_art_id ?? undefined,
    active: row.active === 1,
  };
}

export function getAlbumById(db: Database.Database, id: string): Album | undefined {
  const row = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as DbAlbum | undefined;
  return row ? toAlbum(row) : undefined;
}

export function getAlbumByNameAndArtist(db: Database.Database, name: string, artistId?: string): Album | undefined {
  const row = artistId
    ? db.prepare('SELECT * FROM albums WHERE name = ? COLLATE NOCASE AND artist_id = ?').get(name, artistId) as DbAlbum | undefined
    : db.prepare('SELECT * FROM albums WHERE name = ? COLLATE NOCASE AND artist_id IS NULL').get(name) as DbAlbum | undefined;
  return row ? toAlbum(row) : undefined;
}

export function listInactiveAlbums(db: Database.Database): Album[] {
  const rows = db.prepare(`
    SELECT a.*, ar.name AS artist_name
    FROM albums a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE a.active = 0
    ORDER BY a.name
  `).all() as (DbAlbum & { artist_name: string | null })[];
  return rows.map((row) => ({ ...toAlbum(row), artistName: row.artist_name ?? undefined }));
}

export function deleteAlbumById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM albums WHERE id = ?').run(id);
}

export function upsertAlbum(db: Database.Database, album: Album): void {
  const stmt = db.prepare(`
    INSERT INTO albums (id, name, artist_id, artist_name, year, genre, cover_art_id, active)
    VALUES (@id, @name, @artistId, @artistName, @year, @genre, @coverArt, @active)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      artist_id = excluded.artist_id,
      artist_name = excluded.artist_name,
      year = excluded.year,
      genre = excluded.genre,
      cover_art_id = excluded.cover_art_id,
      active = excluded.active
  `);
  stmt.run({
    id: album.id,
    name: album.name,
    artistId: album.artistId ?? null,
    artistName: album.artistName ?? null,
    year: album.year ?? null,
    genre: album.genre ?? null,
    coverArt: album.coverArt ?? null,
    active: album.active === false ? 0 : 1,
  });
}
