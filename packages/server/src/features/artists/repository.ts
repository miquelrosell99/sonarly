import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Artist } from '@sonarly/shared';

export interface DbArtist {
  id: string;
  name: string;
  active: number;
  artist_image_url: string | null;
  musicbrainz_artist_ids: string | null;
  bio: string | null;
  external_urls: string | null;
}

function toArtist(row: DbArtist): Artist {
  return {
    id: row.id,
    name: row.name,
    active: row.active === 1,
    artistImageUrl: row.artist_image_url ?? undefined,
    musicBrainzArtistIds: row.musicbrainz_artist_ids ? JSON.parse(row.musicbrainz_artist_ids) : undefined,
    bio: row.bio ?? undefined,
    externalUrls: row.external_urls ? JSON.parse(row.external_urls) : undefined,
  };
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
    INSERT INTO artists (id, name, active, artist_image_url, musicbrainz_artist_ids)
    VALUES (@id, @name, @active, @artistImageUrl, @musicBrainzArtistIds)
    ON CONFLICT(name) DO UPDATE SET
      name = excluded.name,
      active = excluded.active,
      artist_image_url = excluded.artist_image_url,
      musicbrainz_artist_ids = excluded.musicbrainz_artist_ids
  `).run({
    id: artist.id,
    name: artist.name,
    active: artist.active === false ? 0 : 1,
    artistImageUrl: artist.artistImageUrl ?? null,
    musicBrainzArtistIds: artist.musicBrainzArtistIds ? JSON.stringify(artist.musicBrainzArtistIds) : null,
  });
}

export function updateArtistImageUrl(db: Database.Database, artistId: string, imageUrl: string | null): void {
  db.prepare('UPDATE artists SET artist_image_url = ? WHERE id = ?').run(imageUrl, artistId);
}

export function updateArtistMetadata(
  db: Database.Database,
  artistId: string,
  metadata: { bio?: string; externalUrls?: Record<string, string> },
): void {
  db.prepare('UPDATE artists SET bio = ?, external_urls = ? WHERE id = ?').run(
    metadata.bio ?? null,
    metadata.externalUrls ? JSON.stringify(metadata.externalUrls) : null,
    artistId,
  );
}

export function updateArtistMusicBrainzIds(
  db: Database.Database,
  artistId: string,
  musicBrainzIds: string[],
): void {
  db.prepare('UPDATE artists SET musicbrainz_artist_ids = ? WHERE id = ?')
    .run(JSON.stringify(musicBrainzIds), artistId);
}

export function ensureArtist(
  db: Database.Database,
  name: string,
  musicBrainzIds?: string[],
): string {
  const trimmed = name.trim();
  const existing = getArtistByName(db, trimmed);
  if (existing) {
    if (musicBrainzIds && musicBrainzIds.length > 0) {
      const merged = Array.from(new Set([...(existing.musicBrainzArtistIds ?? []), ...musicBrainzIds]));
      if (merged.length !== (existing.musicBrainzArtistIds?.length ?? 0)) {
        updateArtistMusicBrainzIds(db, existing.id, merged);
      }
    }
    return existing.id;
  }
  const id = randomUUID();
  upsertArtist(db, { id, name: trimmed, musicBrainzArtistIds: musicBrainzIds });
  return id;
}
