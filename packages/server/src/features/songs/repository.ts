import Database from 'better-sqlite3';
import type { Song } from '@sonarly/shared';

export interface DbSong {
  id: string;
  file_path: string;
  title: string;
  track_number: number | null;
  disc_number: number | null;
  duration: number | null;
  artist_id: string | null;
  album_id: string | null;
  genre: string | null;
  year: number | null;
  explicit: number;
  cover_art_id: string | null;
  cover_art_missing: number | null;
  mtime: number;
  checksum: string;
  active: number;
}

interface DbSongWithInteractions extends DbSong {
  starred: number | null;
  rating: number | null;
}

function toSong(row: DbSong): Song {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    trackNumber: row.track_number ?? undefined,
    discNumber: row.disc_number ?? undefined,
    duration: row.duration ?? undefined,
    artistId: row.artist_id ?? undefined,
    albumId: row.album_id ?? undefined,
    genre: row.genre ?? undefined,
    year: row.year ?? undefined,
    explicit: row.explicit === 1,
    coverArt: row.cover_art_id ?? undefined,
    coverArtMissing: row.cover_art_missing === 1,
    mtime: row.mtime,
    checksum: row.checksum,
    active: row.active === 1,
  };
}

function toSongWithInteractions(row: DbSongWithInteractions): Song {
  return {
    ...toSong(row),
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
  };
}

export function getSongById(db: Database.Database, id: string, userId?: string): Song | undefined {
  if (!userId) {
    const row = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as DbSong | undefined;
    return row ? toSong(row) : undefined;
  }
  const row = db.prepare(`
    SELECT s.*, us.starred, us.rating
    FROM songs s
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.id = ?
  `).get(userId, id) as DbSongWithInteractions | undefined;
  return row ? toSongWithInteractions(row) : undefined;
}

export function getSongByPath(db: Database.Database, path: string): Song | undefined {
  const row = db.prepare('SELECT * FROM songs WHERE file_path = ?').get(path) as DbSong | undefined;
  return row ? toSong(row) : undefined;
}

export function scrobbleSong(db: Database.Database, userId: string, songId: string): void {
  db.prepare(`
    INSERT INTO user_songs (user_id, song_id, play_count, last_played)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(user_id, song_id) DO UPDATE SET
      play_count = play_count + 1,
      last_played = datetime('now')
  `).run(userId, songId);
}

export function upsertSong(db: Database.Database, song: Song): void {
  const stmt = db.prepare(`
    INSERT INTO songs (id, file_path, title, track_number, disc_number, duration, artist_id, album_id, genre, year, explicit, cover_art_id, cover_art_missing, mtime, checksum, active)
    VALUES (@id, @filePath, @title, @trackNumber, @discNumber, @duration, @artistId, @albumId, @genre, @year, @explicit, @coverArt, @coverArtMissing, @mtime, @checksum, @active)
    ON CONFLICT(id) DO UPDATE SET
      file_path = excluded.file_path,
      title = excluded.title,
      track_number = excluded.track_number,
      disc_number = excluded.disc_number,
      duration = excluded.duration,
      artist_id = excluded.artist_id,
      album_id = excluded.album_id,
      genre = excluded.genre,
      year = excluded.year,
      explicit = excluded.explicit,
      cover_art_id = excluded.cover_art_id,
      cover_art_missing = excluded.cover_art_missing,
      mtime = excluded.mtime,
      checksum = excluded.checksum,
      active = excluded.active
  `);
  stmt.run({
    id: song.id,
    filePath: song.filePath,
    title: song.title,
    trackNumber: song.trackNumber ?? null,
    discNumber: song.discNumber ?? null,
    duration: song.duration ?? null,
    artistId: song.artistId ?? null,
    albumId: song.albumId ?? null,
    genre: song.genre ?? null,
    year: song.year ?? null,
    explicit: song.explicit ? 1 : 0,
    coverArt: song.coverArt ?? null,
    coverArtMissing: song.coverArtMissing ? 1 : 0,
    mtime: song.mtime,
    checksum: song.checksum,
    active: song.active === false ? 0 : 1,
  });
}

export function deleteSongByPath(db: Database.Database, path: string): void {
  db.prepare('DELETE FROM songs WHERE file_path = ?').run(path);
}

export function deactivateSongByPath(db: Database.Database, path: string): void {
  db.prepare('UPDATE songs SET active = 0 WHERE file_path = ?').run(path);
}

export function deleteSongById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM songs WHERE id = ?').run(id);
}

export function findInactiveSongByTags(
  db: Database.Database,
  title: string,
  albumId: string | undefined,
  artistId: string | undefined
): Song | undefined {
  const row = db.prepare(`
    SELECT * FROM songs
    WHERE active = 0
      AND LOWER(title) = LOWER(?)
      AND album_id ${albumId ? '= ?' : 'IS NULL'}
      AND artist_id ${artistId ? '= ?' : 'IS NULL'}
    LIMIT 1
  `).get(albumId && artistId ? [title, albumId, artistId] : albumId ? [title, albumId] : artistId ? [title, artistId] : [title]) as DbSong | undefined;
  return row ? toSong(row) : undefined;
}

export function listInactiveSongs(db: Database.Database, userId?: string): Song[] {
  if (!userId) {
    const rows = db.prepare(`
      SELECT s.*, ar.name AS artist_name, al.name AS album_name
      FROM songs s
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      WHERE s.active = 0
      ORDER BY s.title
    `).all() as (DbSong & { artist_name: string | null; album_name: string | null })[];
    return rows.map((row) => ({ ...toSong(row), artistName: row.artist_name ?? undefined, albumName: row.album_name ?? undefined }));
  }
  const rows = db.prepare(`
    SELECT s.*, ar.name AS artist_name, al.name AS album_name, us.starred, us.rating
    FROM songs s
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.active = 0
    ORDER BY s.title
  `).all(userId) as (DbSongWithInteractions & { artist_name: string | null; album_name: string | null })[];
  return rows.map((row) => ({
    ...toSongWithInteractions(row),
    artistName: row.artist_name ?? undefined,
    albumName: row.album_name ?? undefined,
  }));
}

export function listSongsByAlbum(db: Database.Database, albumId: string, userId?: string): Song[] {
  if (!userId) {
    const rows = db.prepare('SELECT * FROM songs WHERE album_id = ? AND active = 1 ORDER BY disc_number, track_number, title')
      .all(albumId) as DbSong[];
    return rows.map(toSong);
  }
  const rows = db.prepare(`
    SELECT s.*, us.starred, us.rating
    FROM songs s
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.album_id = ? AND s.active = 1
    ORDER BY s.disc_number, s.track_number, s.title
  `).all(userId, albumId) as DbSongWithInteractions[];
  return rows.map(toSongWithInteractions);
}

const COLLISION_SUFFIX_REGEX = / \(\d+\)\.[a-z0-9]+$/i;

export function listCollisionSongs(db: Database.Database): Song[] {
  const rows = db.prepare("SELECT * FROM songs WHERE active = 1 AND file_path LIKE '% (%)%'")
    .all() as DbSong[];
  return rows.filter((row) => COLLISION_SUFFIX_REGEX.test(row.file_path)).map(toSong);
}
