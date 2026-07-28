export interface Album {
  id: string;
  name: string;
  artistId?: string;
  artistName?: string;
  artists?: string[];
  year?: number;
  genre?: string;
  genreId?: string;
  genres?: string[];
  genreIds?: string[];
  coverArt?: string;
  totalSongCount?: number;
  shownSongCount?: number;
  active?: boolean;
  starred?: boolean;
  rating?: number;
  labelEntries?: { id: string; name: string }[];
  catalogNumbers?: string[];
  barcode?: string;
  asin?: string;
  musicBrainzAlbumId?: string;
  musicBrainzReleaseGroupId?: string;
  musicBrainzAlbumArtistIds?: string[];
  originalYear?: number;
  compilation?: boolean;
  totalTracks?: string;
  totalDiscs?: string;
}
