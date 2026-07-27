import Database from 'better-sqlite3';
import type {
  ListeningHistoryEntry,
  GenreDistributionItem,
  MonthlyGenrePlaysItem,
  WrappedReport,
  TopSongItem,
  TopArtistItem,
  TopAlbumItem,
} from '@sonarly/shared';

const HISTORY_PAGE_SIZE = 50;

interface DbHistoryRow {
  id: string;
  user_id: string;
  song_id: string;
  played_at: string;
  duration_listened: number | null;
  completion: number | null;
  client: string | null;
  source: string | null;
  title: string;
  artist_name: string | null;
  album_name: string | null;
}

function toHistoryEntry(row: DbHistoryRow): ListeningHistoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    songId: row.song_id,
    playedAt: row.played_at,
    durationListened: row.duration_listened ?? undefined,
    completion: row.completion ?? undefined,
    client: row.client ?? undefined,
    source: row.source ?? undefined,
  };
}

export function getListeningHistory(
  db: Database.Database,
  userId: string,
  page = 1
): ListeningHistoryEntry[] {
  const offset = (Math.max(1, page) - 1) * HISTORY_PAGE_SIZE;
  const rows = db.prepare(`
    SELECT
      lh.id,
      lh.user_id,
      lh.song_id,
      lh.played_at,
      lh.duration_listened,
      lh.completion,
      lh.client,
      lh.source,
      s.title,
      ar.name AS artist_name,
      al.name AS album_name
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    WHERE lh.user_id = ?
    ORDER BY lh.played_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, HISTORY_PAGE_SIZE, offset) as DbHistoryRow[];

  return rows.map(toHistoryEntry);
}

export function getGenreDistribution(
  db: Database.Database,
  userId?: string,
  startDate?: string,
  endDate?: string
): GenreDistributionItem[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (userId) {
    conditions.push('lh.user_id = ?');
    params.push(userId);
  }
  if (startDate) {
    conditions.push("date(lh.played_at) >= date(?)")
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("date(lh.played_at) <= date(?)")
    params.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(g.name, ''), 'Unknown') AS genre,
      COUNT(*) AS plays,
      COALESCE(SUM(lh.duration_listened), 0) AS total_duration_listened
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN genres g ON g.id = s.genre_id
    ${whereClause}
    GROUP BY g.name
    ORDER BY plays DESC
  `).all(...params) as { genre: string; plays: number; total_duration_listened: number }[];

  return rows.map((row) => ({
    genre: row.genre,
    plays: row.plays,
    totalDurationListened: row.total_duration_listened,
  }));
}

export function getMonthlyGenrePlays(
  db: Database.Database,
  userId?: string,
  startDate?: string,
  endDate?: string
): MonthlyGenrePlaysItem[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (userId) {
    conditions.push('lh.user_id = ?');
    params.push(userId);
  }
  if (startDate) {
    conditions.push("date(lh.played_at) >= date(?)")
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("date(lh.played_at) <= date(?)")
    params.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', lh.played_at) AS month,
      COALESCE(NULLIF(g.name, ''), 'Unknown') AS genre,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN genres g ON g.id = s.genre_id
    ${whereClause}
    GROUP BY month, g.name
    ORDER BY month DESC, plays DESC
  `).all(...params) as { month: string; genre: string; plays: number }[];

  return rows.map((row) => ({
    month: row.month,
    genre: row.genre,
    plays: row.plays,
  }));
}

export function getWrapped(db: Database.Database, userId: string, year: number): WrappedReport {
  const nextYear = year + 1;
  const start = `${year}-01-01`;
  const end = `${nextYear}-01-01`;

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_plays,
      COALESCE(SUM(lh.duration_listened), 0) AS total_duration_listened,
      COUNT(DISTINCT s.id) AS unique_songs,
      COUNT(DISTINCT s.artist_id) AS unique_artists,
      COUNT(DISTINCT s.album_id) AS unique_albums
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    WHERE lh.user_id = ?
      AND lh.played_at >= ?
      AND lh.played_at < ?
  `).get(userId, start, end) as {
    total_plays: number;
    total_duration_listened: number;
    unique_songs: number;
    unique_artists: number;
    unique_albums: number;
  };

  const topSongs = db.prepare(`
    SELECT
      s.id AS song_id,
      s.title,
      ar.name AS artist_name,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    WHERE lh.user_id = ?
      AND lh.played_at >= ?
      AND lh.played_at < ?
    GROUP BY s.id
    ORDER BY plays DESC, s.title
    LIMIT 10
  `).all(userId, start, end) as TopSongItem[];

  const topArtists = db.prepare(`
    SELECT
      ar.id AS artist_id,
      ar.name AS artist_name,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    WHERE lh.user_id = ?
      AND lh.played_at >= ?
      AND lh.played_at < ?
    GROUP BY ar.id
    ORDER BY plays DESC, ar.name
    LIMIT 10
  `).all(userId, start, end) as TopArtistItem[];

  const topAlbums = db.prepare(`
    SELECT
      al.id AS album_id,
      al.name AS album_name,
      ar.name AS artist_name,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN albums al ON al.id = s.album_id
    LEFT JOIN artists ar ON ar.id = al.artist_id
    WHERE lh.user_id = ?
      AND lh.played_at >= ?
      AND lh.played_at < ?
    GROUP BY al.id
    ORDER BY plays DESC, al.name
    LIMIT 10
  `).all(userId, start, end) as TopAlbumItem[];

  const topGenres = getGenreDistribution(db, userId, start, end).slice(0, 10);

  const monthlyRows = db.prepare(`
    SELECT
      strftime('%Y-%m', lh.played_at) AS month,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    WHERE lh.user_id = ?
      AND lh.played_at >= ?
      AND lh.played_at < ?
    GROUP BY month
    ORDER BY month
  `).all(userId, start, end) as { month: string; plays: number }[];

  return {
    year,
    totalPlays: totals.total_plays,
    totalDurationListened: totals.total_duration_listened,
    uniqueSongs: totals.unique_songs,
    uniqueArtists: totals.unique_artists,
    uniqueAlbums: totals.unique_albums,
    topSongs,
    topArtists,
    topAlbums,
    topGenres,
    monthlyPlays: monthlyRows,
  };
}
