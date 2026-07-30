export interface MusicBrainzMatch {
  id: string;
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  albumArtist?: string;
  albumArtists?: string[];
  trackNumber?: number;
  discNumber?: number;
  genre?: string;
  genres?: string[];
  year?: number;
  coverArt?: string;
  disambiguation?: string;
}

export interface MusicBrainzSearchResult {
  matches: MusicBrainzMatch[];
}
