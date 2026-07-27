import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Song, ScrobbleDetails } from '@sonarly/shared';

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
  genre_id: string | null;
  year: number | null;
  explicit: number;
  cover_art_id: string | null;
  cover_art_missing: number | null;
  mtime: number;
  checksum: string;
  active: number;
  bit_rate: number | null;
  bits_per_sample: number | null;
  sample_rate: number | null;
  channels: number | null;
  bpm: number | null;
  music_brainz_id: string | null;
  musicbrainz_track_id: string | null;
  musicbrainz_work_id: string | null;
  musicbrainz_disc_id: string | null;
  replay_gain: number | null;
  average_rating: number | null;
  comment: string | null;
  sort_name: string | null;
  mood: string | null;
  media_type: string | null;
  original_release_date: string | null;
  release_date: string | null;
  remix_of: string | null;
  display_artist: string | null;
  display_album_artist: string | null;
  lyrics: string | null;
  synced_lyrics: string | null;
  composers: string | null;
  producers: string | null;
  isrcs: string | null;
  original_year: number | null;
  original_artist: string | null;
  gapless: number | null;
  total_tracks: string | null;
  total_discs: string | null;
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
    genreId: row.genre_id ?? undefined,
    year: row.year ?? undefined,
    explicit: row.explicit === 1,
    coverArt: row.cover_art_id ?? undefined,
    coverArtMissing: row.cover_art_missing === 1,
    mtime: row.mtime,
    checksum: row.checksum,
    active: row.active === 1,
    bitRate: row.bit_rate ?? undefined,
    bitsPerSample: row.bits_per_sample ?? undefined,
    sampleRate: row.sample_rate ?? undefined,
    channels: row.channels ?? undefined,
    bpm: row.bpm ?? undefined,
    musicBrainzId: row.music_brainz_id ?? undefined,
    musicBrainzTrackId: row.musicbrainz_track_id ?? undefined,
    musicBrainzWorkId: row.musicbrainz_work_id ?? undefined,
    musicBrainzDiscId: row.musicbrainz_disc_id ?? undefined,
    replayGain: row.replay_gain ?? undefined,
    averageRating: row.average_rating ?? undefined,
    comment: row.comment ?? undefined,
    sortName: row.sort_name ?? undefined,
    mood: row.mood ?? undefined,
    mediaType: row.media_type ?? undefined,
    originalReleaseDate: row.original_release_date ?? undefined,
    releaseDate: row.release_date ?? undefined,
    remixOf: row.remix_of ?? undefined,
    displayArtist: row.display_artist ?? undefined,
    displayAlbumArtist: row.display_album_artist ?? undefined,
    lyrics: row.lyrics ?? undefined,
    syncedLyrics: row.synced_lyrics ? JSON.parse(row.synced_lyrics) : undefined,
    composers: row.composers ? JSON.parse(row.composers) : undefined,
    producers: row.producers ? JSON.parse(row.producers) : undefined,
    isrcs: row.isrcs ? JSON.parse(row.isrcs) : undefined,
    originalYear: row.original_year ?? undefined,
    originalArtist: row.original_artist ?? undefined,
    gapless: row.gapless === 1,
    totalTracks: row.total_tracks ?? undefined,
    totalDiscs: row.total_discs ?? undefined,
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

export function scrobbleSong(
  db: Database.Database,
  userId: string,
  songId: string,
  details?: ScrobbleDetails
): void {
  const upsertUserSong = db.prepare(`
    INSERT INTO user_songs (user_id, song_id, play_count, last_played)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(user_id, song_id) DO UPDATE SET
      play_count = play_count + 1,
      last_played = datetime('now')
  `);

  const insertHistory = db.prepare(`
    INSERT INTO listening_history (id, user_id, song_id, played_at, duration_listened, completion, client, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const playedAt = details?.playedAt ?? new Date().toISOString();

  db.transaction(() => {
    upsertUserSong.run(userId, songId);
    insertHistory.run(
      randomUUID(),
      userId,
      songId,
      playedAt,
      details?.durationListened ?? null,
      details?.completion ?? null,
      details?.client ?? null,
      details?.source ?? null
    );
  })();
}

export function upsertSong(db: Database.Database, song: Song): void {
  const stmt = db.prepare(`
    INSERT INTO songs (id, file_path, title, track_number, disc_number, duration, artist_id, album_id, genre, genre_id, year, explicit, cover_art_id, cover_art_missing, mtime, checksum, active, bit_rate, bits_per_sample, sample_rate, channels, bpm, music_brainz_id, musicbrainz_track_id, musicbrainz_work_id, musicbrainz_disc_id, replay_gain, average_rating, comment, sort_name, mood, media_type, original_release_date, release_date, remix_of, display_artist, display_album_artist, lyrics, synced_lyrics, composers, producers, isrcs, original_year, original_artist, gapless, total_tracks, total_discs)
    VALUES (@id, @filePath, @title, @trackNumber, @discNumber, @duration, @artistId, @albumId, @genre, @genreId, @year, @explicit, @coverArt, @coverArtMissing, @mtime, @checksum, @active, @bitRate, @bitsPerSample, @sampleRate, @channels, @bpm, @musicBrainzId, @musicBrainzTrackId, @musicBrainzWorkId, @musicBrainzDiscId, @replayGain, @averageRating, @comment, @sortName, @mood, @mediaType, @originalReleaseDate, @releaseDate, @remixOf, @displayArtist, @displayAlbumArtist, @lyrics, @syncedLyrics, @composers, @producers, @isrcs, @originalYear, @originalArtist, @gapless, @totalTracks, @totalDiscs)
    ON CONFLICT(id) DO UPDATE SET
      file_path = excluded.file_path,
      title = excluded.title,
      track_number = excluded.track_number,
      disc_number = excluded.disc_number,
      duration = excluded.duration,
      artist_id = excluded.artist_id,
      album_id = excluded.album_id,
      genre = excluded.genre,
      genre_id = excluded.genre_id,
      year = excluded.year,
      explicit = excluded.explicit,
      cover_art_id = excluded.cover_art_id,
      cover_art_missing = excluded.cover_art_missing,
      mtime = excluded.mtime,
      checksum = excluded.checksum,
      active = excluded.active,
      bit_rate = excluded.bit_rate,
      bits_per_sample = excluded.bits_per_sample,
      sample_rate = excluded.sample_rate,
      channels = excluded.channels,
      bpm = excluded.bpm,
      music_brainz_id = excluded.music_brainz_id,
      musicbrainz_track_id = excluded.musicbrainz_track_id,
      musicbrainz_work_id = excluded.musicbrainz_work_id,
      musicbrainz_disc_id = excluded.musicbrainz_disc_id,
      replay_gain = excluded.replay_gain,
      average_rating = excluded.average_rating,
      comment = excluded.comment,
      sort_name = excluded.sort_name,
      mood = excluded.mood,
      media_type = excluded.media_type,
      original_release_date = excluded.original_release_date,
      release_date = excluded.release_date,
      remix_of = excluded.remix_of,
      display_artist = excluded.display_artist,
      display_album_artist = excluded.display_album_artist,
      lyrics = excluded.lyrics,
      synced_lyrics = excluded.synced_lyrics,
      composers = excluded.composers,
      producers = excluded.producers,
      isrcs = excluded.isrcs,
      original_year = excluded.original_year,
      original_artist = excluded.original_artist,
      gapless = excluded.gapless,
      total_tracks = excluded.total_tracks,
      total_discs = excluded.total_discs
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
    genreId: song.genreId ?? null,
    year: song.year ?? null,
    explicit: song.explicit ? 1 : 0,
    coverArt: song.coverArt ?? null,
    coverArtMissing: song.coverArtMissing ? 1 : 0,
    mtime: song.mtime,
    checksum: song.checksum,
    active: song.active === false ? 0 : 1,
    bitRate: song.bitRate ?? null,
    bitsPerSample: song.bitsPerSample ?? null,
    sampleRate: song.sampleRate ?? null,
    channels: song.channels ?? null,
    bpm: song.bpm ?? null,
    musicBrainzId: song.musicBrainzId ?? null,
    musicBrainzTrackId: song.musicBrainzTrackId ?? null,
    musicBrainzWorkId: song.musicBrainzWorkId ?? null,
    musicBrainzDiscId: song.musicBrainzDiscId ?? null,
    replayGain: song.replayGain ?? null,
    averageRating: song.averageRating ?? null,
    comment: song.comment ?? null,
    sortName: song.sortName ?? null,
    mood: song.mood ?? null,
    mediaType: song.mediaType ?? null,
    originalReleaseDate: song.originalReleaseDate ?? null,
    releaseDate: song.releaseDate ?? null,
    remixOf: song.remixOf ?? null,
    displayArtist: song.displayArtist ?? null,
    displayAlbumArtist: song.displayAlbumArtist ?? null,
    lyrics: song.lyrics ?? null,
    syncedLyrics: song.syncedLyrics ? JSON.stringify(song.syncedLyrics) : null,
    composers: song.composers ? JSON.stringify(song.composers) : null,
    producers: song.producers ? JSON.stringify(song.producers) : null,
    isrcs: song.isrcs ? JSON.stringify(song.isrcs) : null,
    originalYear: song.originalYear ?? null,
    originalArtist: song.originalArtist ?? null,
    gapless: song.gapless ? 1 : 0,
    totalTracks: song.totalTracks ?? null,
    totalDiscs: song.totalDiscs ?? null,
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
    const songs = rows.map((row) => ({ ...toSong(row), artistName: row.artist_name ?? undefined, albumName: row.album_name ?? undefined }));
    attachSongArtistEntries(db, songs);
    return songs;
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
  const songs = rows.map((row) => ({
    ...toSongWithInteractions(row),
    artistName: row.artist_name ?? undefined,
    albumName: row.album_name ?? undefined,
  }));
  attachSongArtistEntries(db, songs);
  return songs;
}

export function listSongsByArtist(db: Database.Database, artistId: string, userId?: string): Song[] {
  if (!userId) {
    const rows = db.prepare(`
      SELECT * FROM songs
      WHERE artist_id = ? AND active = 1
      ORDER BY year, album_id, disc_number, track_number, title
    `).all(artistId) as DbSong[];
    const songs = rows.map(toSong);
    attachSongArtistEntries(db, songs);
    return songs;
  }
  const rows = db.prepare(`
    SELECT s.*, us.starred, us.rating
    FROM songs s
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.artist_id = ? AND s.active = 1
    ORDER BY s.year, s.album_id, s.disc_number, s.track_number, s.title
  `).all(userId, artistId) as DbSongWithInteractions[];
  const songs = rows.map(toSongWithInteractions);
  attachSongArtistEntries(db, songs);
  return songs;
}

export function listSongsByAlbum(db: Database.Database, albumId: string, userId?: string): Song[] {
  const baseSelect = `
    SELECT s.*, ar.name AS artist_name, al.name AS album_name, al.artist_name AS album_artist_name
  `;
  const baseFrom = `
    FROM songs s
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    WHERE s.album_id = ? AND s.active = 1
    ORDER BY s.disc_number, s.track_number, s.title
  `;
  interface NamesRow {
    artist_name: string | null;
    album_name: string | null;
    album_artist_name: string | null;
  }
  const mapRow = (row: DbSong & NamesRow) => ({
    ...toSong(row),
    artistName: row.artist_name ?? undefined,
    albumName: row.album_name ?? undefined,
    albumArtistName: row.album_artist_name ?? undefined,
  });
  if (!userId) {
    const rows = db.prepare(`${baseSelect} ${baseFrom}`).all(albumId) as (DbSong & NamesRow)[];
    const songs = rows.map(mapRow);
    attachSongArtistEntries(db, songs);
    return songs;
  }
  const rows = db.prepare(`${baseSelect}, us.starred, us.rating ${baseFrom.replace('WHERE', 'LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id WHERE')}`)
    .all(userId, albumId) as (DbSongWithInteractions & NamesRow)[];
  const songs = rows.map((row) => ({
    ...toSongWithInteractions(row),
    artistName: row.artist_name ?? undefined,
    albumName: row.album_name ?? undefined,
    albumArtistName: row.album_artist_name ?? undefined,
  }));
  attachSongArtistEntries(db, songs);
  return songs;
}

const COLLISION_SUFFIX_REGEX = / \(\d+\)\.[a-z0-9]+$/i;

export function listCollisionSongs(db: Database.Database): Song[] {
  const rows = db.prepare("SELECT * FROM songs WHERE active = 1 AND file_path LIKE '% (%)%'")
    .all() as DbSong[];
  return rows.filter((row) => COLLISION_SUFFIX_REGEX.test(row.file_path)).map(toSong);
}

export function setSongArtists(
  db: Database.Database,
  songId: string,
  artistIds: string[],
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM song_artists WHERE song_id = ?').run(songId);
    const insert = db.prepare(
      'INSERT INTO song_artists (song_id, artist_id, position) VALUES (?, ?, ?)'
    );
    for (const [position, artistId] of artistIds.entries()) {
      insert.run(songId, artistId, position);
    }
  })();
}

export function getSongArtistIds(db: Database.Database, songId: string): string[] {
  return db.prepare(
    'SELECT artist_id FROM song_artists WHERE song_id = ? ORDER BY position'
  ).pluck().all(songId) as string[];
}

export function getSongArtistNames(db: Database.Database, songId: string): string[] {
  return db.prepare(`
    SELECT ar.name
    FROM song_artists sa
    JOIN artists ar ON ar.id = sa.artist_id
    WHERE sa.song_id = ?
    ORDER BY sa.position
  `).pluck().all(songId) as string[];
}

export function getSongArtistNamesForMany(
  db: Database.Database,
  songIds: string[],
): Map<string, string[]> {
  if (songIds.length === 0) return new Map();
  const placeholders = songIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT sa.song_id, ar.name
    FROM song_artists sa
    JOIN artists ar ON ar.id = sa.artist_id
    WHERE sa.song_id IN (${placeholders})
    ORDER BY sa.song_id, sa.position
  `).all(...songIds) as { song_id: string; name: string }[];
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.song_id) ?? [];
    list.push(row.name);
    map.set(row.song_id, list);
  }
  return map;
}

export function getSongArtistEntries(
  db: Database.Database,
  songId: string,
): { id: string; name: string }[] {
  return db.prepare(`
    SELECT ar.id, ar.name
    FROM song_artists sa
    JOIN artists ar ON ar.id = sa.artist_id
    WHERE sa.song_id = ?
    ORDER BY sa.position
  `).all(songId) as { id: string; name: string }[];
}

export function getSongArtistEntriesForMany(
  db: Database.Database,
  songIds: string[],
): Map<string, { id: string; name: string }[]> {
  if (songIds.length === 0) return new Map();
  const placeholders = songIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT sa.song_id, ar.id, ar.name
    FROM song_artists sa
    JOIN artists ar ON ar.id = sa.artist_id
    WHERE sa.song_id IN (${placeholders})
    ORDER BY sa.song_id, sa.position
  `).all(...songIds) as { song_id: string; id: string; name: string }[];
  const map = new Map<string, { id: string; name: string }[]>();
  for (const row of rows) {
    const list = map.get(row.song_id) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.song_id, list);
  }
  return map;
}

export function attachSongArtistEntries(db: Database.Database, songs: Song[]): void {
  if (songs.length === 0) return;
  const entries = getSongArtistEntriesForMany(db, songs.map((s) => s.id));
  for (const song of songs) {
    const list = entries.get(song.id);
    if (list && list.length > 0) {
      song.artistEntries = list;
    }
  }
}

export interface AlbumSongStats {
  songCount: number;
  duration: number;
}

export function getAlbumSongStatsForMany(
  db: Database.Database,
  albumIds: string[],
): Map<string, AlbumSongStats> {
  if (albumIds.length === 0) return new Map();
  const placeholders = albumIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT album_id, COUNT(*) AS song_count, COALESCE(SUM(duration), 0) AS duration
    FROM songs
    WHERE album_id IN (${placeholders}) AND active = 1
    GROUP BY album_id
  `).all(...albumIds) as { album_id: string; song_count: number; duration: number }[];
  const map = new Map<string, AlbumSongStats>();
  for (const row of rows) {
    map.set(row.album_id, { songCount: row.song_count, duration: row.duration });
  }
  return map;
}
