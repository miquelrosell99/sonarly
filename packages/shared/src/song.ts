export interface SyncedLyricLine {
  time: number;
  text: string;
}

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
  genreId?: string;
  genres?: string[];
  genreIds?: string[];
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
  musicBrainzTrackId?: string;
  musicBrainzWorkId?: string;
  musicBrainzDiscId?: string;
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
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
  artists?: string[];
  artistEntries?: { id: string; name: string }[];
  composers?: string[];
  producers?: string[];
  isrcs?: string[];
  originalYear?: number;
  originalArtist?: string;
  gapless?: boolean;
  totalTracks?: string;
  totalDiscs?: string;
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
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
}
