export interface Artist {
  id: string;
  name: string;
  active?: boolean;
  starred?: boolean;
  rating?: number;
  artistImageUrl?: string;
  musicBrainzArtistIds?: string[];
  bio?: string;
  externalUrls?: Record<string, string>;
}
