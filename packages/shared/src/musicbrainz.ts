export interface MusicBrainzMatch {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  genre?: string;
  year?: number;
  coverArt?: string;
  disambiguation?: string;
}

export interface MusicBrainzSearchResult {
  matches: MusicBrainzMatch[];
}
