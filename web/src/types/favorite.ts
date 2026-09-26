export type FavoriteEntityType = 'song' | 'album' | 'artist' | 'playlist';

/** POST /api/favorites body: exactly one per-type id key plus the starred flag. */
export interface FavoriteInput {
  songId?: string;
  albumId?: string;
  artistId?: string;
  playlistId?: string;
  starred: boolean;
}

/** POST /api/ratings body: exactly one per-type id key plus the rating (omit to clear). */
export interface RatingInput {
  songId?: string;
  albumId?: string;
  artistId?: string;
  playlistId?: string;
  rating?: number;
}
