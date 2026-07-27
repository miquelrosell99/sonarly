export interface Song {
  id: string;
  filePath: string;
  title: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;
  artistId?: string;
  albumId?: string;
  artistName?: string;
  albumName?: string;
  genre?: string;
  year?: number;
  explicit?: boolean;
  coverArt?: string;
  coverArtMissing?: boolean;
  mtime: number;
  checksum: string;
  active?: boolean;
  starred?: boolean;
  rating?: number;
  bitRate?: number;
  bitsPerSample?: number;
  sampleRate?: number;
  channels?: number;
  bpm?: number;
  musicBrainzId?: string;
  replayGain?: number;
  averageRating?: number;
  comment?: string;
  sortName?: string;
  mood?: string;
  mediaType?: string;
  originalReleaseDate?: string;
  releaseDate?: string;
  remixOf?: string;
  displayArtist?: string;
  displayAlbumArtist?: string;
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
  explicit?: boolean;
}
