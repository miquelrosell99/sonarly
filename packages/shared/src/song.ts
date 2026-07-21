export interface Song {
  id: string;
  filePath: string;
  title: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;
  artistId?: string;
  albumId?: string;
  genre?: string;
  year?: number;
  coverArt?: string;
  mtime: number;
  checksum: string;
}

export interface SongTags {
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  genre?: string;
  year?: number;
}
