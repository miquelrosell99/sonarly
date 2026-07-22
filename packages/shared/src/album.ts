export interface Album {
  id: string;
  name: string;
  artistId?: string;
  artistName?: string;
  year?: number;
  genre?: string;
  coverArt?: string;
  totalSongCount?: number;
  shownSongCount?: number;
  starred?: boolean;
  rating?: number;
}
