import Database from 'better-sqlite3';
import type { FavoriteEntityType } from '@sonarly/shared';

interface TableMap {
  table: string;
  idColumn: string;
}

const TABLE_MAP: Record<FavoriteEntityType, TableMap> = {
  song: { table: 'user_songs', idColumn: 'song_id' },
  album: { table: 'user_albums', idColumn: 'album_id' },
  artist: { table: 'user_artists', idColumn: 'artist_id' },
  playlist: { table: 'user_playlists', idColumn: 'playlist_id' },
};

export interface FavoriteRow {
  starred: number;
  rating: number | null;
}

export function getFavorite(
  db: Database.Database,
  userId: string,
  entityType: FavoriteEntityType,
  entityId: string,
): { starred: boolean; rating?: number } | undefined {
  const { table, idColumn } = TABLE_MAP[entityType];
  const row = db.prepare(`SELECT starred, rating FROM ${table} WHERE user_id = ? AND ${idColumn} = ?`)
    .get(userId, entityId) as FavoriteRow | undefined;
  if (!row) return undefined;
  return {
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
  };
}

export function setFavorite(
  db: Database.Database,
  userId: string,
  entityType: FavoriteEntityType,
  entityId: string,
  starred: boolean,
): void {
  const { table, idColumn } = TABLE_MAP[entityType];
  db.prepare(`
    INSERT INTO ${table} (user_id, ${idColumn}, starred) VALUES (?, ?, ?)
    ON CONFLICT(user_id, ${idColumn}) DO UPDATE SET starred = excluded.starred
  `).run(userId, entityId, starred ? 1 : 0);
}

export function setRating(
  db: Database.Database,
  userId: string,
  entityType: FavoriteEntityType,
  entityId: string,
  rating: number | undefined,
): void {
  const { table, idColumn } = TABLE_MAP[entityType];
  db.prepare(`
    INSERT INTO ${table} (user_id, ${idColumn}, rating) VALUES (?, ?, ?)
    ON CONFLICT(user_id, ${idColumn}) DO UPDATE SET rating = excluded.rating
  `).run(userId, entityId, rating ?? null);
}
