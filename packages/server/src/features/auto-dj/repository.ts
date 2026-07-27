import Database from 'better-sqlite3';
import type { Song } from '@sonarly/shared';
import type { DbSong } from '../songs/repository.js';

interface CandidateRow extends DbSong {
  artist_name: string | null;
  album_name: string | null;
  starred: number | null;
  rating: number | null;
  play_count: number | null;
  last_played: string | null;
  genre_overlap?: number;
}

export interface SongContext {
  id: string;
  artistId?: string;
  albumId?: string;
  bpm?: number;
  mood?: string;
  genreIds: string[];
  rating?: number;
  playCount?: number;
  lastPlayed?: string;
}

function rowToSong(row: CandidateRow): Song & { artistName?: string; albumName?: string } {
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
    artistName: row.artist_name ?? undefined,
    albumName: row.album_name ?? undefined,
    starred: row.starred === 1,
    rating: row.rating ?? undefined,
  };
}

const MAX_EXCLUDE_IDS = 500;

function buildExcludeClause(excludeIds: string[]): { sql: string; params: string[] } {
  if (excludeIds.length === 0) return { sql: '', params: [] };
  const capped = excludeIds.slice(0, MAX_EXCLUDE_IDS);
  const placeholders = capped.map(() => '?').join(',');
  return { sql: `AND s.id NOT IN (${placeholders})`, params: capped };
}

export function getSongContext(
  db: Database.Database,
  songId: string,
  userId: string,
): SongContext | undefined {
  const row = db.prepare(`
    SELECT s.id, s.artist_id, s.album_id, s.bpm, s.mood,
           us.rating, us.play_count, us.last_played
    FROM songs s
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.id = ? AND s.active = 1
  `).get(userId, songId) as
    | {
        id: string;
        artist_id: string | null;
        album_id: string | null;
        bpm: number | null;
        mood: string | null;
        rating: number | null;
        play_count: number | null;
        last_played: string | null;
      }
    | undefined;

  if (!row) return undefined;

  const genreIds = db.prepare(`
    SELECT genre_id FROM song_genres WHERE song_id = ?
  `).pluck().all(songId) as string[];

  return {
    id: row.id,
    artistId: row.artist_id ?? undefined,
    albumId: row.album_id ?? undefined,
    bpm: row.bpm ?? undefined,
    mood: row.mood ?? undefined,
    genreIds,
    rating: row.rating ?? undefined,
    playCount: row.play_count ?? undefined,
    lastPlayed: row.last_played ?? undefined,
  };
}

export function getSimilarCandidates(
  db: Database.Database,
  userId: string,
  context: SongContext | undefined,
  count: number,
  excludeIds: string[],
): Song[] {
  const exclude = buildExcludeClause(excludeIds);
  let rows: CandidateRow[] = [];

  if (context && (context.artistId || context.albumId || context.genreIds.length > 0)) {
    const genrePlaceholders = context.genreIds.length > 0
      ? context.genreIds.map(() => '?').join(',')
      : null;
    const sql = `
      SELECT s.*, ar.name AS artist_name, al.name AS album_name, us.starred, us.rating, us.play_count, us.last_played
      FROM songs s
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
      WHERE s.active = 1
        AND s.id != ?
        ${exclude.sql}
        AND (
          s.artist_id = ?
          OR s.album_id = ?
          ${genrePlaceholders ? `OR EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id AND sg.genre_id IN (${genrePlaceholders}))` : ''}
        )
      ORDER BY RANDOM()
      LIMIT ?
    `;
    const params: (string | number | null)[] = [
      userId,
      context.id,
      ...exclude.params,
      context.artistId ?? null,
      context.albumId ?? null,
      ...(genrePlaceholders ? context.genreIds : []),
      count,
    ];
    rows = db.prepare(sql).all(...params) as CandidateRow[];
  }

  const songs = rows.map(rowToSong);

  if (songs.length < count) {
    const more = getRandomCandidates(db, userId, count - songs.length, [
      ...excludeIds,
      ...songs.map((s) => s.id),
      ...(context ? [context.id] : []),
    ]);
    songs.push(...more);
  }

  return songs;
}

export function getRandomCandidates(
  db: Database.Database,
  userId: string,
  count: number,
  excludeIds: string[],
): Song[] {
  const exclude = buildExcludeClause(excludeIds);
  let rows = db.prepare(`
    SELECT s.*, ar.name AS artist_name, al.name AS album_name, us.starred, us.rating, us.play_count, us.last_played
    FROM songs s
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.active = 1
      ${exclude.sql}
      AND (us.last_played IS NULL OR us.last_played < datetime('now', '-24 hours'))
    ORDER BY RANDOM()
    LIMIT ?
  `).all(userId, ...exclude.params, count) as CandidateRow[];

  if (rows.length < count) {
    const fallbackExclude = buildExcludeClause([...excludeIds, ...rows.map((r) => r.id)]);
    const more = db.prepare(`
      SELECT s.*, ar.name AS artist_name, al.name AS album_name, us.starred, us.rating, us.play_count, us.last_played
      FROM songs s
      LEFT JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
      WHERE s.active = 1
        ${fallbackExclude.sql}
      ORDER BY RANDOM()
      LIMIT ?
    `).all(userId, ...fallbackExclude.params, count - rows.length) as CandidateRow[];
    rows = [...rows, ...more];
  }

  return rows.map(rowToSong);
}

export interface SmartCandidate {
  song: Song & { artistName?: string; albumName?: string };
  rating?: number;
  playCount?: number;
  lastPlayed?: string;
  genreOverlap: number;
}

export function getSmartCandidateRows(
  db: Database.Database,
  userId: string,
  context: SongContext | undefined,
  excludeIds: string[],
): SmartCandidate[] {
  const exclude = buildExcludeClause(excludeIds);
  const genreOverlapSql = context && context.genreIds.length > 0
    ? `(
        SELECT COUNT(*)
        FROM song_genres csg
        WHERE csg.song_id = s.id
          AND csg.genre_id IN (${context.genreIds.map(() => '?').join(',')})
      )`
    : '0';

  const sql = `
    SELECT s.*, ar.name AS artist_name, al.name AS album_name, us.starred, us.rating, us.play_count, us.last_played,
           ${genreOverlapSql} AS genre_overlap
    FROM songs s
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
    WHERE s.active = 1
      ${exclude.sql}
    ORDER BY RANDOM()
    LIMIT 500
  `;

  const params: (string | number | null)[] = [
    userId,
    ...exclude.params,
    ...(context ? context.genreIds : []),
  ];

  const rows = db.prepare(sql).all(...params) as CandidateRow[];
  return rows.map((row) => ({
    song: rowToSong(row),
    rating: row.rating ?? undefined,
    playCount: row.play_count ?? undefined,
    lastPlayed: row.last_played ?? undefined,
    genreOverlap: row.genre_overlap ?? 0,
  }));
}

export function getUserAveragePlayCount(db: Database.Database, userId: string): number {
  const row = db.prepare(`
    SELECT AVG(play_count) AS avg_play_count FROM user_songs WHERE user_id = ?
  `).get(userId) as { avg_play_count: number | null } | undefined;
  return row?.avg_play_count ?? 0;
}
