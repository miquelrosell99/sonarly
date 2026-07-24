import Database from 'better-sqlite3';
import type { Artist } from '@sonarly/shared';

export interface DbArtist {
  id: string;
  name: string;
  active: number;
}

function toArtist(row: DbArtist): Artist {
  return { id: row.id, name: row.name, active: row.active === 1 };
}

export function getArtistByName(db: Database.Database, name: string): Artist | undefined {
  const row = db.prepare('SELECT * FROM artists WHERE name = ? COLLATE NOCASE').get(name) as DbArtist | undefined;
  return row ? toArtist(row) : undefined;
}

export function listInactiveArtists(db: Database.Database): Artist[] {
  const rows = db.prepare('SELECT * FROM artists WHERE active = 0 ORDER BY name').all() as DbArtist[];
  return rows.map(toArtist);
}

export function deleteArtistById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM artists WHERE id = ?').run(id);
}

export function upsertArtist(db: Database.Database, artist: Artist): void {
  db.prepare(`
    INSERT INTO artists (id, name, active) VALUES (@id, @name, @active)
    ON CONFLICT(name) DO UPDATE SET name = excluded.name, active = excluded.active
  `).run({ ...artist, active: artist.active === false ? 0 : 1 });
}
