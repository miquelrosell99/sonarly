export interface ScrobbleDetails {
  durationListened?: number;
  completion?: number;
  client?: string;
  source?: string;
  playedAt?: string;
}

export interface ListeningHistoryEntry {
  id: string;
  userId: string;
  songId: string;
  playedAt: string;
  durationListened?: number;
  completion?: number;
  client?: string;
  source?: string;
}

export interface GenreDistributionItem {
  genre: string;
  plays: number;
  totalDurationListened: number;
}

export interface MonthlyGenrePlaysItem {
  month: string;
  genre: string;
  plays: number;
}

export interface TopSongItem {
  songId: string;
  title: string;
  artistName?: string;
  albumCoverArt?: string;
  plays: number;
}

export interface TopArtistItem {
  artistId?: string;
  artistName: string;
  plays: number;
}

export interface TopAlbumItem {
  albumId?: string;
  albumName: string;
  artistName?: string;
  coverArt?: string;
  plays: number;
}

export interface TopYearItem {
  year: number;
  plays: number;
  totalDurationListened: number;
}

export interface WrappedReport {
  year: number;
  totalPlays: number;
  totalDurationListened: number;
  uniqueSongs: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  topSongs: TopSongItem[];
  topArtists: TopArtistItem[];
  topAlbums: TopAlbumItem[];
  topGenres: GenreDistributionItem[];
  monthlyPlays: { month: string; plays: number }[];
}

export interface ListeningStatsResponse {
  genreDistribution: GenreDistributionItem[];
  monthlyGenrePlays: MonthlyGenrePlaysItem[];
}

export type StatisticsTimeRange = '7d' | '30d' | '90d' | '1y' | 'all';

export interface StatisticsTotals {
  totalPlays: number;
  totalDurationListened: number;
  favoriteSongs: number;
  favoriteAlbums: number;
  favoriteArtists: number;
}

export interface RatingDistributionItem {
  rating: number;
  count: number;
}

export interface RatingDistributionWithUnrated {
  unrated: number;
  ratings: RatingDistributionItem[];
}

export interface StatisticsTopLists {
  topSongs: TopSongItem[];
  topArtists: TopArtistItem[];
  topAlbums: TopAlbumItem[];
  topGenres: GenreDistributionItem[];
  topYears: TopYearItem[];
}

export interface RatedArtistItem {
  artistId?: string;
  artistName: string;
  averageRating: number;
  bayesianAverage: number;
  ratedSongs: number;
}

export interface RatedAlbumItem {
  albumId?: string;
  albumName: string;
  artistName?: string;
  coverArt?: string;
  averageRating: number;
  bayesianAverage: number;
  ratedSongs: number;
}

export interface TopRatedGenreItem {
  genre: string;
  averageRating: number;
  bayesianAverage: number;
  ratedSongs: number;
}

export interface TopRatedYearItem {
  year: number;
  averageRating: number;
  bayesianAverage: number;
  ratedSongs: number;
}

export interface StatisticsRatedLists {
  topRatedArtists: RatedArtistItem[];
  topRatedGenres: TopRatedGenreItem[];
  topRatedYears: TopRatedYearItem[];
}

export interface StatisticsCharts {
  ratingDistribution: RatingDistributionWithUnrated;
}

export interface StatisticsMonthlyPlaysItem {
  month: string;
  plays: number;
}

export interface MonthlyPlaysGroupItem {
  key: string;
  plays: number;
}

export interface MonthlyGroupedPlaysItem {
  month: string;
  groups: MonthlyPlaysGroupItem[];
}

export type MonthlyPlaysGroupBy = 'artist' | 'genre' | 'year' | 'rating' | 'favorite';

export interface UserStatistics {
  userId: string;
  username: string;
  displayName?: string;
  range: StatisticsTimeRange;
  totals: StatisticsTotals;
  top: StatisticsTopLists;
  rated: StatisticsRatedLists;
  charts: StatisticsCharts;
  monthlyPlays: StatisticsMonthlyPlaysItem[];
}

export interface OverallStatistics {
  range: StatisticsTimeRange;
  totals: StatisticsTotals;
  top: StatisticsTopLists;
  rated: StatisticsRatedLists;
  charts: StatisticsCharts;
  monthlyPlays: StatisticsMonthlyPlaysItem[];
  userSummaries: Array<{
    userId: string;
    username: string;
    displayName?: string;
    totalPlays: number;
    totalDurationListened: number;
    uniqueSongs: number;
  }>;
}
