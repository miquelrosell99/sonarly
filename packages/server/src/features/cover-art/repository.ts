import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

export interface CoverArtData {
  data: Buffer;
  format: string;
}

export interface CoverArt extends CoverArtData {
  id: string;
  hash: string;
}

function computeHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function createCoverArt(db: Database.Database, data: Buffer, format: string): string {
  const hash = computeHash(data);
  const existingId = db.prepare('SELECT id FROM cover_arts WHERE hash = ?').pluck().get(hash) as string | undefined;
  if (existingId) return existingId;

  const id = randomUUID();
  db.prepare('INSERT INTO cover_arts (id, format, data, hash) VALUES (?, ?, ?, ?)').run(id, format, data, hash);
  return id;
}

export function getCoverArtById(db: Database.Database, id: string): CoverArt | undefined {
  const row = db.prepare('SELECT id, format, data, hash FROM cover_arts WHERE id = ?').get(id) as CoverArt | undefined;
  return row;
}

export function deleteCoverArt(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM cover_arts WHERE id = ?').run(id);
}

export function getAlbumCoverArtId(db: Database.Database, albumId: string): string | undefined {
  return db.prepare('SELECT cover_art_id FROM albums WHERE id = ?').pluck().get(albumId) as string | undefined;
}

export function setAlbumCoverArtId(db: Database.Database, albumId: string, coverArtId: string | null): void {
  db.prepare('UPDATE albums SET cover_art_id = ? WHERE id = ?').run(coverArtId, albumId);
}

export function getSongCoverArtId(db: Database.Database, songId: string): string | undefined {
  return db.prepare('SELECT cover_art_id FROM songs WHERE id = ?').pluck().get(songId) as string | undefined;
}

export function setSongCoverArtId(db: Database.Database, songId: string, coverArtId: string | null): void {
  db.prepare('UPDATE songs SET cover_art_id = ? WHERE id = ?').run(coverArtId, songId);
}
