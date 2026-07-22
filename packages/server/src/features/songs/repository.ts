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
  cover_art: string | null;
  mtime: number;
  checksum: string;
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
    coverArt: row.cover_art ?? undefined,
    mtime: row.mtime,
    checksum: row.checksum,
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
    INSERT INTO songs (id, file_path, title, track_number, disc_number, duration, artist_id, album_id, genre, year, explicit, cover_art, mtime, checksum)
    VALUES (@id, @filePath, @title, @trackNumber, @discNumber, @duration, @artistId, @albumId, @genre, @year, @explicit, @coverArt, @mtime, @checksum)
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
      cover_art = excluded.cover_art,
      mtime = excluded.mtime,
      checksum = excluded.checksum
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
    mtime: song.mtime,
    checksum: song.checksum,
  });
}

export function deleteSongByPath(db: Database.Database, path: string): void {
  db.prepare('DELETE FROM songs WHERE file_path = ?').run(path);
}

export function listSongsByAlbum(db: Database.Database, albumId: string, userId?: string): Song[] {
  if (!userId) {
    const rows = db.prepare('SELECT * FROM songs WHERE album_id = ? ORDER BY disc_number, track_number, title')
      .all(albumId) as DbSong[];
    return rows.map(toSong);
  }
  const rows = db.prepare(`
    SELECT s.*, us.starred, us.rating
    FROM songs s
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.album_id = ?
    ORDER BY s.disc_number, s.track_number, s.title
  `).all(userId, albumId) as DbSongWithInteractions[];
  return rows.map(toSongWithInteractions);
}

const COLLISION_SUFFIX_REGEX = / \(\d+\)\.[a-z0-9]+$/i;

export function listCollisionSongs(db: Database.Database): Song[] {
  const rows = db.prepare("SELECT * FROM songs WHERE file_path LIKE '% (%)%'")
    .all() as DbSong[];
  return rows.filter((row) => COLLISION_SUFFIX_REGEX.test(row.file_path)).map(toSong);
}
