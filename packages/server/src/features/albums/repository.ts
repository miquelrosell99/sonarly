import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Album } from '@sonarly/shared';

export interface DbAlbum {
  id: string;
  name: string;
  artist_id: string | null;
  artist_name: string | null;
  year: number | null;
  genre: string | null;
  genre_id: string | null;
  cover_art_id: string | null;
  active: number;
  catalog_numbers: string | null;
  barcode: string | null;
  asin: string | null;
  musicbrainz_album_id: string | null;
  musicbrainz_release_group_id: string | null;
  musicbrainz_album_artist_ids: string | null;
  original_year: number | null;
  compilation: number | null;
  total_tracks: string | null;
  total_discs: string | null;
}

export function toAlbum(row: DbAlbum): Album {
  return {
    id: row.id,
    name: row.name,
    artistId: row.artist_id ?? undefined,
    artistName: row.artist_name ?? undefined,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    genreId: row.genre_id ?? undefined,
    coverArt: row.cover_art_id ?? undefined,
    active: row.active === 1,
    catalogNumbers: row.catalog_numbers ? JSON.parse(row.catalog_numbers) : undefined,
    barcode: row.barcode ?? undefined,
    asin: row.asin ?? undefined,
    musicBrainzAlbumId: row.musicbrainz_album_id ?? undefined,
    musicBrainzReleaseGroupId: row.musicbrainz_release_group_id ?? undefined,
    musicBrainzAlbumArtistIds: row.musicbrainz_album_artist_ids ? JSON.parse(row.musicbrainz_album_artist_ids) : undefined,
    originalYear: row.original_year ?? undefined,
    compilation: row.compilation === 1,
    totalTracks: row.total_tracks ?? undefined,
    totalDiscs: row.total_discs ?? undefined,
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
  const albums = rows.map((row) => ({ ...toAlbum(row), artistName: row.artist_name ?? undefined }));
  attachAlbumLabelEntries(db, albums);
  return albums;
}

export function deleteAlbumById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM albums WHERE id = ?').run(id);
}

export function upsertAlbum(db: Database.Database, album: Album): void {
  const stmt = db.prepare(`
    INSERT INTO albums (id, name, artist_id, artist_name, year, genre, genre_id, cover_art_id, active, catalog_numbers, barcode, asin, musicbrainz_album_id, musicbrainz_release_group_id, musicbrainz_album_artist_ids, original_year, compilation, total_tracks, total_discs)
    VALUES (@id, @name, @artistId, @artistName, @year, @genre, @genreId, @coverArt, @active, @catalogNumbers, @barcode, @asin, @musicBrainzAlbumId, @musicBrainzReleaseGroupId, @musicBrainzAlbumArtistIds, @originalYear, @compilation, @totalTracks, @totalDiscs)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      artist_id = excluded.artist_id,
      artist_name = excluded.artist_name,
      year = excluded.year,
      genre = excluded.genre,
      genre_id = excluded.genre_id,
      cover_art_id = excluded.cover_art_id,
      active = excluded.active,
      catalog_numbers = excluded.catalog_numbers,
      barcode = excluded.barcode,
      asin = excluded.asin,
      musicbrainz_album_id = excluded.musicbrainz_album_id,
      musicbrainz_release_group_id = excluded.musicbrainz_release_group_id,
      musicbrainz_album_artist_ids = excluded.musicbrainz_album_artist_ids,
      original_year = excluded.original_year,
      compilation = excluded.compilation,
      total_tracks = excluded.total_tracks,
      total_discs = excluded.total_discs
  `);
  stmt.run({
    id: album.id,
    name: album.name,
    artistId: album.artistId ?? null,
    artistName: album.artistName ?? null,
    year: album.year ?? null,
    genre: album.genre ?? null,
    genreId: album.genreId ?? null,
    coverArt: album.coverArt ?? null,
    active: album.active === false ? 0 : 1,
    catalogNumbers: album.catalogNumbers ? JSON.stringify(album.catalogNumbers) : null,
    barcode: album.barcode ?? null,
    asin: album.asin ?? null,
    musicBrainzAlbumId: album.musicBrainzAlbumId ?? null,
    musicBrainzReleaseGroupId: album.musicBrainzReleaseGroupId ?? null,
    musicBrainzAlbumArtistIds: album.musicBrainzAlbumArtistIds ? JSON.stringify(album.musicBrainzAlbumArtistIds) : null,
    originalYear: album.originalYear ?? null,
    compilation: album.compilation ? 1 : 0,
    totalTracks: album.totalTracks ?? null,
    totalDiscs: album.totalDiscs ?? null,
  });
}

export function setAlbumArtists(
  db: Database.Database,
  albumId: string,
  artistIds: string[],
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM album_artists WHERE album_id = ?').run(albumId);
    const insert = db.prepare(
      'INSERT INTO album_artists (album_id, artist_id, position) VALUES (?, ?, ?)'
    );
    for (const [position, artistId] of artistIds.entries()) {
      insert.run(albumId, artistId, position);
    }
  })();
}

export function getAlbumArtistIds(db: Database.Database, albumId: string): string[] {
  return db.prepare(
    'SELECT artist_id FROM album_artists WHERE album_id = ? ORDER BY position'
  ).pluck().all(albumId) as string[];
}

export function getAlbumArtistNames(db: Database.Database, albumId: string): string[] {
  return db.prepare(`
    SELECT ar.name
    FROM album_artists aa
    JOIN artists ar ON ar.id = aa.artist_id
    WHERE aa.album_id = ?
    ORDER BY aa.position
  `).pluck().all(albumId) as string[];
}

export function getAlbumArtistNamesForMany(
  db: Database.Database,
  albumIds: string[],
): Map<string, string[]> {
  if (albumIds.length === 0) return new Map();
  const placeholders = albumIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT aa.album_id, ar.name
    FROM album_artists aa
    JOIN artists ar ON ar.id = aa.artist_id
    WHERE aa.album_id IN (${placeholders})
    ORDER BY aa.album_id, aa.position
  `).all(...albumIds) as { album_id: string; name: string }[];
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.album_id) ?? [];
    list.push(row.name);
    map.set(row.album_id, list);
  }
  return map;
}

export function getAlbumArtistEntries(
  db: Database.Database,
  albumId: string,
): { id: string; name: string }[] {
  return db.prepare(`
    SELECT ar.id, ar.name
    FROM album_artists aa
    JOIN artists ar ON ar.id = aa.artist_id
    WHERE aa.album_id = ?
    ORDER BY aa.position
  `).all(albumId) as { id: string; name: string }[];
}

export function getAlbumArtistEntriesForMany(
  db: Database.Database,
  albumIds: string[],
): Map<string, { id: string; name: string }[]> {
  if (albumIds.length === 0) return new Map();
  const placeholders = albumIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT aa.album_id, ar.id, ar.name
    FROM album_artists aa
    JOIN artists ar ON ar.id = aa.artist_id
    WHERE aa.album_id IN (${placeholders})
    ORDER BY aa.album_id, aa.position
  `).all(...albumIds) as { album_id: string; id: string; name: string }[];
  const map = new Map<string, { id: string; name: string }[]>();
  for (const row of rows) {
    const list = map.get(row.album_id) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.album_id, list);
  }
  return map;
}

export function getLabelByName(db: Database.Database, name: string): { id: string; name: string } | undefined {
  return db.prepare('SELECT id, name FROM labels WHERE name = ? COLLATE NOCASE').get(name) as { id: string; name: string } | undefined;
}

export function upsertLabel(
  db: Database.Database,
  label: { id: string; name: string; active?: boolean },
): void {
  db.prepare(`
    INSERT INTO labels (id, name, active)
    VALUES (@id, @name, @active)
    ON CONFLICT(name) DO UPDATE SET
      name = excluded.name,
      active = excluded.active
  `).run({
    id: label.id,
    name: label.name,
    active: label.active === false ? 0 : 1,
  });
}

export function ensureLabel(db: Database.Database, name: string): string {
  const trimmed = name.trim();
  const existing = getLabelByName(db, trimmed);
  if (existing) return existing.id;
  const id = randomUUID();
  upsertLabel(db, { id, name: trimmed });
  return id;
}

export function setAlbumLabels(
  db: Database.Database,
  albumId: string,
  labelIds: string[],
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM album_labels WHERE album_id = ?').run(albumId);
    const insert = db.prepare(
      'INSERT INTO album_labels (album_id, label_id, position) VALUES (?, ?, ?)'
    );
    for (const [position, labelId] of labelIds.entries()) {
      insert.run(albumId, labelId, position);
    }
  })();
}

export function getAlbumLabelIds(db: Database.Database, albumId: string): string[] {
  return db.prepare(
    'SELECT label_id FROM album_labels WHERE album_id = ? ORDER BY position'
  ).pluck().all(albumId) as string[];
}

export function getAlbumLabelNames(db: Database.Database, albumId: string): string[] {
  return db.prepare(`
    SELECT l.name
    FROM album_labels al
    JOIN labels l ON l.id = al.label_id
    WHERE al.album_id = ?
    ORDER BY al.position
  `).pluck().all(albumId) as string[];
}

export function getAlbumLabelEntries(
  db: Database.Database,
  albumId: string,
): { id: string; name: string }[] {
  return db.prepare(`
    SELECT l.id, l.name
    FROM album_labels al
    JOIN labels l ON l.id = al.label_id
    WHERE al.album_id = ?
    ORDER BY al.position
  `).all(albumId) as { id: string; name: string }[];
}

export function getAlbumLabelEntriesForMany(
  db: Database.Database,
  albumIds: string[],
): Map<string, { id: string; name: string }[]> {
  if (albumIds.length === 0) return new Map();
  const placeholders = albumIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT al.album_id, l.id, l.name
    FROM album_labels al
    JOIN labels l ON l.id = al.label_id
    WHERE al.album_id IN (${placeholders})
    ORDER BY al.album_id, al.position
  `).all(...albumIds) as { album_id: string; id: string; name: string }[];
  const map = new Map<string, { id: string; name: string }[]>();
  for (const row of rows) {
    const list = map.get(row.album_id) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.album_id, list);
  }
  return map;
}

export function attachAlbumLabelEntries(db: Database.Database, albums: Album[]): void {
  if (albums.length === 0) return;
  const entries = getAlbumLabelEntriesForMany(db, albums.map((a) => a.id));
  for (const album of albums) {
    const list = entries.get(album.id);
    if (list && list.length > 0) {
      album.labelEntries = list;
    }
  }
}
