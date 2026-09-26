export type FavoriteEntityType = 'song' | 'album' | 'artist' | 'playlist';

export interface FavoriteInput {
  entityType: FavoriteEntityType;
  entityId: string;
  starred: boolean;
}

export interface RatingInput {
  entityType: FavoriteEntityType;
  entityId: string;
  rating?: number;
}
