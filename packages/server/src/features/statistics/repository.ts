import Database from 'better-sqlite3';
import type {
  StatisticsTimeRange,
  StatisticsTotals,
  StatisticsTopLists,
  StatisticsRatedLists,
  StatisticsCharts,
  StatisticsMonthlyPlaysItem,
  MonthlyPlaysGroupBy,
  MonthlyGroupedPlaysItem,
  UserStatistics,
  OverallStatistics,
  TopSongItem,
  TopArtistItem,
  TopAlbumItem,
  TopYearItem,
  GenreDistributionItem,
  RatingDistributionItem,
  RatingDistributionWithUnrated,
  TopRatedGenreItem,
  TopRatedYearItem,
  RatedArtistItem,
} from '@sonarly/shared';

const TOP_LIMIT = 10;
const GENRE_LIMIT = 10;
const MIN_RATED_SONGS = 2;
const BAYESIAN_PRIOR_COUNT = 5;

function getGlobalSongRatingAverage(db: Database.Database, userId?: string): number {
  const conditions: string[] = ['rating IS NOT NULL'];
  const params: (string | number)[] = [];

  if (userId) {
    conditions.push('user_id = ?');
    params.push(userId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const row = db.prepare(`
    SELECT COALESCE(AVG(rating), 0) AS average FROM user_songs ${where}
  `).get(...params) as { average: number };
  return row.average;
}


const RANGE_SQL: Record<StatisticsTimeRange, string | null> = {
  '7d': "date(lh.played_at) >= date('now', '-7 days')",
  '30d': "date(lh.played_at) >= date('now', '-30 days')",
  '90d': "date(lh.played_at) >= date('now', '-90 days')",
  '1y': "date(lh.played_at) >= date('now', '-1 year')",
  all: null,
};

function buildHistoryWhere(userId?: string, range: StatisticsTimeRange = 'all'): { where: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (userId) {
    conditions.push('lh.user_id = ?');
    params.push(userId);
  }

  const rangeSql = RANGE_SQL[range];
  if (rangeSql) {
    conditions.push(rangeSql);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

function formatDuration(seconds: number): number {
  return Math.round(seconds);
}

function getTotals(db: Database.Database, userId?: string, range: StatisticsTimeRange = 'all'): StatisticsTotals {
  const { where, params } = buildHistoryWhere(userId, range);

  const totalsRow = db.prepare(`
    SELECT
      COUNT(*) AS total_plays,
      COALESCE(SUM(lh.duration_listened), 0) AS total_duration_listened
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    ${where}
  `).get(...params) as {
    total_plays: number;
    total_duration_listened: number;
  };

  const favoriteSongs = (db.prepare(`
    SELECT COUNT(*) AS count FROM user_songs WHERE user_id = ? AND starred = 1
  `).get(userId) as { count: number }).count;

  const favoriteAlbums = (db.prepare(`
    SELECT COUNT(*) AS count FROM user_albums WHERE user_id = ? AND starred = 1
  `).get(userId) as { count: number }).count;

  const favoriteArtists = (db.prepare(`
    SELECT COUNT(*) AS count FROM user_artists WHERE user_id = ? AND starred = 1
  `).get(userId) as { count: number }).count;

  return {
    totalPlays: totalsRow.total_plays,
    totalDurationListened: formatDuration(totalsRow.total_duration_listened),
    favoriteSongs,
    favoriteAlbums,
    favoriteArtists,
  };
}

function getTopSongs(db: Database.Database, userId?: string, range: StatisticsTimeRange = 'all'): TopSongItem[] {
  const { where, params } = buildHistoryWhere(userId, range);
  const rows = db.prepare(`
    SELECT
      s.id AS song_id,
      s.title,
      ar.name AS artist_name,
      COALESCE(s.cover_art_id, al.cover_art_id) AS album_cover_art,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    ${where}
    GROUP BY s.id
    ORDER BY plays DESC, s.title
    LIMIT ?
  `).all(...params, TOP_LIMIT) as {
    song_id: string;
    title: string;
    artist_name: string | null;
    album_cover_art: string | null;
    plays: number;
  }[];

  return rows.map((row) => ({
    songId: row.song_id,
    title: row.title,
    artistName: row.artist_name ?? undefined,
    albumCoverArt: row.album_cover_art ?? undefined,
    plays: row.plays,
  }));
}

function getTopArtists(db: Database.Database, userId?: string, range: StatisticsTimeRange = 'all'): TopArtistItem[] {
  const { where, params } = buildHistoryWhere(userId, range);
  const rows = db.prepare(`
    SELECT
      ar.id AS artist_id,
      ar.name AS artist_name,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    ${where}
    GROUP BY ar.id
    ORDER BY plays DESC, ar.name
    LIMIT ?
  `).all(...params, TOP_LIMIT) as {
    artist_id: string | null;
    artist_name: string;
    plays: number;
  }[];

  return rows.map((row) => ({
    artistId: row.artist_id ?? undefined,
    artistName: row.artist_name,
    plays: row.plays,
  }));
}

function getTopAlbums(db: Database.Database, userId?: string, range: StatisticsTimeRange = 'all'): TopAlbumItem[] {
  const { where, params } = buildHistoryWhere(userId, range);
  const rows = db.prepare(`
    SELECT
      al.id AS album_id,
      al.name AS album_name,
      ar.name AS artist_name,
      al.cover_art_id AS cover_art,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN albums al ON al.id = s.album_id
    LEFT JOIN artists ar ON ar.id = al.artist_id
    ${where}
    GROUP BY al.id
    ORDER BY plays DESC, al.name
    LIMIT ?
  `).all(...params, TOP_LIMIT) as {
    album_id: string | null;
    album_name: string;
    artist_name: string | null;
    cover_art: string | null;
    plays: number;
  }[];

  return rows.map((row) => ({
    albumId: row.album_id ?? undefined,
    albumName: row.album_name,
    artistName: row.artist_name ?? undefined,
    coverArt: row.cover_art ?? undefined,
    plays: row.plays,
  }));
}

function getTopGenres(db: Database.Database, userId?: string, range: StatisticsTimeRange = 'all'): GenreDistributionItem[] {
  const { where, params } = buildHistoryWhere(userId, range);
  return db.prepare(`
    SELECT
      COALESCE(NULLIF(g.name, ''), 'Unknown') AS genre,
      COUNT(*) AS plays,
      COALESCE(SUM(lh.duration_listened), 0) AS total_duration_listened
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    LEFT JOIN genres g ON g.id = s.genre_id
    ${where}
    GROUP BY g.name
    ORDER BY plays DESC
    LIMIT ?
  `).all(...params, GENRE_LIMIT) as GenreDistributionItem[];
}

function getTopYears(db: Database.Database, userId?: string, range: StatisticsTimeRange = 'all'): TopYearItem[] {
  const { where, params } = buildHistoryWhere(userId, range);
  const rows = db.prepare(`
    SELECT
      s.year AS year,
      COUNT(*) AS plays,
      COALESCE(SUM(lh.duration_listened), 0) AS total_duration_listened
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    WHERE s.year IS NOT NULL
    ${where ? `AND ${where.replace(/^WHERE /, '')}` : ''}
    GROUP BY s.year
    ORDER BY plays DESC
    LIMIT ?
  `).all(...params, TOP_LIMIT) as {
    year: number;
    plays: number;
    total_duration_listened: number;
  }[];

  return rows.map((row) => ({
    year: row.year,
    plays: row.plays,
    totalDurationListened: formatDuration(row.total_duration_listened),
  }));
}

function getMonthlyPlays(db: Database.Database, userId?: string, range: StatisticsTimeRange = 'all'): StatisticsMonthlyPlaysItem[] {
  const { where, params } = buildHistoryWhere(userId, range);
  return db.prepare(`
    SELECT
      strftime('%Y-%m', lh.played_at) AS month,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    ${where}
    GROUP BY month
    ORDER BY month
  `).all(...params) as StatisticsMonthlyPlaysItem[];
}

const GROUP_BY_LIMIT = 6;

function getMonthlyGroupedPlays(
  db: Database.Database,
  userId: string,
  range: StatisticsTimeRange = 'all',
  groupBy: MonthlyPlaysGroupBy = 'artist',
): MonthlyGroupedPlaysItem[] {
  const { where, params } = buildHistoryWhere(userId, range);

  let selectColumn: string;
  let joinClause = '';
  let groupColumns: string;

  switch (groupBy) {
    case 'artist':
      selectColumn = "COALESCE(ar.name, 'Unknown')";
      joinClause = 'LEFT JOIN artists ar ON ar.id = s.artist_id';
      groupColumns = 'ar.name';
      break;
    case 'genre':
      selectColumn = "COALESCE(NULLIF(g.name, ''), 'Unknown')";
      joinClause = 'LEFT JOIN genres g ON g.id = s.genre_id';
      groupColumns = 'g.name';
      break;
    case 'year':
      selectColumn = "COALESCE(CAST(s.year AS TEXT), 'Unknown')";
      groupColumns = 's.year';
      break;
    case 'rating': {
      const ratingWhere = where ? `${where} AND us.rating IS NOT NULL` : 'WHERE us.rating IS NOT NULL';
      const unratedWhere = where ? `${where} AND us.rating IS NULL` : 'WHERE us.rating IS NULL';

      const ratedRows = db.prepare(`
        SELECT
          strftime('%Y-%m', lh.played_at) AS month,
          CAST(us.rating AS TEXT) AS key,
          COUNT(*) AS plays
        FROM listening_history lh
        JOIN songs s ON s.id = lh.song_id
        JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
        ${joinClause}
        ${ratingWhere}
        GROUP BY month, us.rating
        ORDER BY month, plays DESC
      `).all(...[userId, ...params]) as { month: string; key: string; plays: number }[];

      const unratedRows = db.prepare(`
        SELECT
          strftime('%Y-%m', lh.played_at) AS month,
          'Unrated' AS key,
          COUNT(*) AS plays
        FROM listening_history lh
        JOIN songs s ON s.id = lh.song_id
        LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
        ${joinClause}
        ${unratedWhere}
        GROUP BY month
        ORDER BY month
      `).all(...[userId, ...params]) as { month: string; key: string; plays: number }[];

      const combined = [...ratedRows, ...unratedRows];
      return aggregateGroupedPlays(combined, GROUP_BY_LIMIT);
    }
    case 'favorite': {
      const favoriteWhere = where ? `${where} AND us.starred = 1` : 'WHERE us.starred = 1';
      const notFavoriteWhere = where ? `${where} AND (us.starred = 0 OR us.starred IS NULL)` : 'WHERE (us.starred = 0 OR us.starred IS NULL)';

      const favoriteRows = db.prepare(`
        SELECT
          strftime('%Y-%m', lh.played_at) AS month,
          'Favorite' AS key,
          COUNT(*) AS plays
        FROM listening_history lh
        JOIN songs s ON s.id = lh.song_id
        JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
        ${joinClause}
        ${favoriteWhere}
        GROUP BY month
        ORDER BY month
      `).all(...[userId, ...params]) as { month: string; key: string; plays: number }[];

      const notFavoriteRows = db.prepare(`
        SELECT
          strftime('%Y-%m', lh.played_at) AS month,
          'Not favorite' AS key,
          COUNT(*) AS plays
        FROM listening_history lh
        JOIN songs s ON s.id = lh.song_id
        LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
        ${joinClause}
        ${notFavoriteWhere}
        GROUP BY month
        ORDER BY month
      `).all(...[userId, ...params]) as { month: string; key: string; plays: number }[];

      const combined = [...favoriteRows, ...notFavoriteRows];
      return aggregateGroupedPlays(combined, GROUP_BY_LIMIT);
    }
    default:
      selectColumn = "'Unknown'";
      groupColumns = '1';
  }

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', lh.played_at) AS month,
      ${selectColumn} AS key,
      COUNT(*) AS plays
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    ${joinClause}
    ${where}
    GROUP BY month, ${groupColumns}
    ORDER BY month, plays DESC
  `).all(...params) as { month: string; key: string; plays: number }[];

  return aggregateGroupedPlays(rows, GROUP_BY_LIMIT);
}

function aggregateGroupedPlays(rows: { month: string; key: string; plays: number }[], limit: number): MonthlyGroupedPlaysItem[] {
  const byMonth = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (!byMonth.has(row.month)) {
      byMonth.set(row.month, new Map());
    }
    const groups = byMonth.get(row.month)!;
    groups.set(row.key, (groups.get(row.key) ?? 0) + row.plays);
  }

  const result: MonthlyGroupedPlaysItem[] = [];
  for (const [month, groups] of byMonth) {
    const sorted = Array.from(groups.entries())
      .map(([key, plays]) => ({ key, plays }))
      .sort((a, b) => b.plays - a.plays);

    const top = sorted.slice(0, limit);
    const other = sorted.slice(limit).reduce((sum, g) => sum + g.plays, 0);
    if (other > 0) {
      top.push({ key: 'Other', plays: other });
    }

    result.push({ month, groups: top });
  }

  return result.sort((a, b) => a.month.localeCompare(b.month));
}

function getTopLists(db: Database.Database, userId?: string, range: StatisticsTimeRange = 'all'): StatisticsTopLists {
  return {
    topSongs: getTopSongs(db, userId, range),
    topArtists: getTopArtists(db, userId, range),
    topAlbums: getTopAlbums(db, userId, range),
    topGenres: getTopGenres(db, userId, range),
    topYears: getTopYears(db, userId, range),
  };
}

function getRatingDistribution(db: Database.Database, userId?: string): RatingDistributionWithUnrated {
  const ratedConditions: string[] = ['rating IS NOT NULL'];
  const unratedConditions: string[] = ['rating IS NULL'];
  const params: (string | number)[] = [];

  if (userId) {
    ratedConditions.push('user_id = ?');
    unratedConditions.push('user_id = ?');
    params.push(userId);
  }

  const ratedWhere = `WHERE ${ratedConditions.join(' AND ')}`;
  const unratedWhere = `WHERE ${unratedConditions.join(' AND ')}`;

  const songs = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM user_songs ${ratedWhere} GROUP BY rating
  `).all(...params) as { rating: number; count: number }[];

  const albums = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM user_albums ${ratedWhere} GROUP BY rating
  `).all(...params) as { rating: number; count: number }[];

  const artists = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM user_artists ${ratedWhere} GROUP BY rating
  `).all(...params) as { rating: number; count: number }[];

  const unratedSongs = (db.prepare(`
    SELECT COUNT(*) AS count FROM user_songs ${unratedWhere}
  `).get(...params) as { count: number }).count;

  const unratedAlbums = (db.prepare(`
    SELECT COUNT(*) AS count FROM user_albums ${unratedWhere}
  `).get(...params) as { count: number }).count;

  const unratedArtists = (db.prepare(`
    SELECT COUNT(*) AS count FROM user_artists ${unratedWhere}
  `).get(...params) as { count: number }).count;

  const counts = new Map<number, number>();
  for (const row of [...songs, ...albums, ...artists]) {
    counts.set(row.rating, (counts.get(row.rating) ?? 0) + row.count);
  }

  return {
    unrated: unratedSongs + unratedAlbums + unratedArtists,
    ratings: [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: counts.get(rating) ?? 0,
    })),
  };
}

function getTopRatedArtists(db: Database.Database, userId?: string): RatedArtistItem[] {
  const conditions: string[] = ['us.rating IS NOT NULL'];
  const globalAverage = getGlobalSongRatingAverage(db, userId);
  // Placeholders appear in SQL in this order: Bayesian prior, global average, prior, user_id, min rated, limit.
  const params: (string | number)[] = [BAYESIAN_PRIOR_COUNT, globalAverage, BAYESIAN_PRIOR_COUNT];

  if (userId) {
    conditions.push('us.user_id = ?');
    params.push(userId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT
      ar.id AS artist_id,
      ar.name AS artist_name,
      ROUND(AVG(us.rating), 2) AS average_rating,
      COUNT(*) AS rated_songs,
      ROUND((SUM(us.rating) + ? * ?) / (COUNT(*) + ?), 2) AS bayesian_average
    FROM user_songs us
    JOIN songs s ON s.id = us.song_id
    LEFT JOIN artists ar ON ar.id = s.artist_id
    ${where}
    GROUP BY ar.id
    HAVING rated_songs >= ?
    ORDER BY bayesian_average DESC, rated_songs DESC, ar.name
    LIMIT ?
  `).all(...params, MIN_RATED_SONGS, TOP_LIMIT) as {
    artist_id: string | null;
    artist_name: string;
    average_rating: number;
    rated_songs: number;
    bayesian_average: number;
  }[];

  return rows.map((row) => ({
    artistId: row.artist_id ?? undefined,
    artistName: row.artist_name,
    averageRating: row.average_rating,
    bayesianAverage: row.bayesian_average,
    ratedSongs: row.rated_songs,
  }));
}

function getTopRatedGenres(db: Database.Database, userId?: string): TopRatedGenreItem[] {
  const conditions: string[] = ['us.rating IS NOT NULL'];
  const globalAverage = getGlobalSongRatingAverage(db, userId);
  const params: (string | number)[] = [BAYESIAN_PRIOR_COUNT, globalAverage, BAYESIAN_PRIOR_COUNT];

  if (userId) {
    conditions.push('us.user_id = ?');
    params.push(userId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(g.name, ''), 'Unknown') AS genre,
      ROUND(AVG(us.rating), 2) AS average_rating,
      COUNT(*) AS rated_songs,
      ROUND((SUM(us.rating) + ? * ?) / (COUNT(*) + ?), 2) AS bayesian_average
    FROM user_songs us
    JOIN songs s ON s.id = us.song_id
    LEFT JOIN genres g ON g.id = s.genre_id
    ${where}
    GROUP BY g.name
    HAVING rated_songs >= ?
    ORDER BY bayesian_average DESC, rated_songs DESC
    LIMIT ?
  `).all(...params, MIN_RATED_SONGS, TOP_LIMIT) as {
    genre: string;
    average_rating: number;
    rated_songs: number;
    bayesian_average: number;
  }[];

  return rows.map((row) => ({
    genre: row.genre,
    averageRating: row.average_rating,
    bayesianAverage: row.bayesian_average,
    ratedSongs: row.rated_songs,
  }));
}

function getTopRatedYears(db: Database.Database, userId?: string): TopRatedYearItem[] {
  const conditions: string[] = ['us.rating IS NOT NULL', 's.year IS NOT NULL'];
  const globalAverage = getGlobalSongRatingAverage(db, userId);
  const params: (string | number)[] = [BAYESIAN_PRIOR_COUNT, globalAverage, BAYESIAN_PRIOR_COUNT];

  if (userId) {
    conditions.push('us.user_id = ?');
    params.push(userId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT
      s.year AS year,
      ROUND(AVG(us.rating), 2) AS average_rating,
      COUNT(*) AS rated_songs,
      ROUND((SUM(us.rating) + ? * ?) / (COUNT(*) + ?), 2) AS bayesian_average
    FROM user_songs us
    JOIN songs s ON s.id = us.song_id
    ${where}
    GROUP BY s.year
    HAVING rated_songs >= ?
    ORDER BY bayesian_average DESC, rated_songs DESC
    LIMIT ?
  `).all(...params, MIN_RATED_SONGS, TOP_LIMIT) as {
    year: number;
    average_rating: number;
    rated_songs: number;
    bayesian_average: number;
  }[];

  return rows.map((row) => ({
    year: row.year,
    averageRating: row.average_rating,
    bayesianAverage: row.bayesian_average,
    ratedSongs: row.rated_songs,
  }));
}

function getRatedLists(db: Database.Database, userId?: string): StatisticsRatedLists {
  return {
    topRatedArtists: getTopRatedArtists(db, userId),
    topRatedGenres: getTopRatedGenres(db, userId),
    topRatedYears: getTopRatedYears(db, userId),
  };
}

function getCharts(db: Database.Database, userId?: string): StatisticsCharts {
  return {
    ratingDistribution: getRatingDistribution(db, userId),
  };
}

interface DbUserRow {
  id: string;
  username: string;
  name: string | null;
  surname: string | null;
}

function displayName(row: DbUserRow): string | undefined {
  const full = [row.name, row.surname].filter(Boolean).join(' ');
  return full || undefined;
}

export function getUserStatistics(
  db: Database.Database,
  userId: string,
  range: StatisticsTimeRange = 'all',
): UserStatistics {
  const userRow = db.prepare('SELECT id, username, name, surname FROM users WHERE id = ?').get(userId) as DbUserRow | undefined;
  if (!userRow) {
    throw new Error('User not found');
  }

  return {
    userId: userRow.id,
    username: userRow.username,
    displayName: displayName(userRow),
    range,
    totals: getTotals(db, userId, range),
    top: getTopLists(db, userId, range),
    rated: getRatedLists(db, userId),
    charts: getCharts(db, userId),
    monthlyPlays: getMonthlyPlays(db, userId, range),
  };
}

export function getOverallStatistics(
  db: Database.Database,
  range: StatisticsTimeRange = 'all',
): OverallStatistics {
  return {
    range,
    totals: getTotals(db, undefined, range),
    top: getTopLists(db, undefined, range),
    rated: getRatedLists(db, undefined),
    charts: getCharts(db, undefined),
    monthlyPlays: getMonthlyPlays(db, undefined, range),
    userSummaries: getUserSummaries(db, range),
  };
}

export { getMonthlyGroupedPlays };

function getUserSummaries(
  db: Database.Database,
  range: StatisticsTimeRange = 'all',
): OverallStatistics['userSummaries'] {
  const { where, params } = buildHistoryWhere(undefined, range);
  const rows = db.prepare(`
    SELECT
      u.id AS user_id,
      u.username,
      u.name,
      u.surname,
      COUNT(*) AS total_plays,
      COALESCE(SUM(lh.duration_listened), 0) AS total_duration_listened,
      COUNT(DISTINCT s.id) AS unique_songs
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    JOIN users u ON u.id = lh.user_id
    ${where}
    GROUP BY u.id
    ORDER BY total_plays DESC
  `).all(...params) as {
    user_id: string;
    username: string;
    name: string | null;
    surname: string | null;
    total_plays: number;
    total_duration_listened: number;
    unique_songs: number;
  }[];

  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: displayName({
      id: row.user_id,
      username: row.username,
      name: row.name,
      surname: row.surname,
    }),
    totalPlays: row.total_plays,
    totalDurationListened: formatDuration(row.total_duration_listened),
    uniqueSongs: row.unique_songs,
  }));
}
