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
  plays: number;
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
