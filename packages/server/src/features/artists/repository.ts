import Database from 'better-sqlite3';
import type { Artist } from '@sonarly/shared';

export interface DbArtist {
  id: string;
  name: string;
}

function toArtist(row: DbArtist): Artist {
  return { id: row.id, name: row.name };
}

export function getArtistByName(db: Database.Database, name: string): Artist | undefined {
  const row = db.prepare('SELECT * FROM artists WHERE name = ? COLLATE NOCASE').get(name) as DbArtist | undefined;
  return row ? toArtist(row) : undefined;
}

export function upsertArtist(db: Database.Database, artist: Artist): void {
  db.prepare(`
    INSERT INTO artists (id, name) VALUES (@id, @name)
    ON CONFLICT(name) DO UPDATE SET name = excluded.name
  `).run(artist);
}
