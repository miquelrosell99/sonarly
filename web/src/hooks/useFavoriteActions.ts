import type { FavoriteEntityType } from '../types';
import { api } from '../lib/api.js';

export interface FavoriteActions {
  setFavorite: (entityType: FavoriteEntityType, entityId: string, starred: boolean) => Promise<void>;
  setRating: (entityType: FavoriteEntityType, entityId: string, rating?: number) => Promise<void>;
}

/** The server's per-type id key (POST /api/favorites, POST /api/ratings). */
const ENTITY_ID_KEYS: Record<FavoriteEntityType, string> = {
  song: 'songId',
  album: 'albumId',
  artist: 'artistId',
  playlist: 'playlistId',
};

export function useFavoriteActions(): FavoriteActions {
  const setFavorite = async (entityType: FavoriteEntityType, entityId: string, starred: boolean) => {
    await api('/favorites', {
      method: 'POST',
      body: JSON.stringify({ [ENTITY_ID_KEYS[entityType]]: entityId, starred }),
    });
  };

  const setRating = async (entityType: FavoriteEntityType, entityId: string, rating?: number) => {
    await api('/ratings', {
      method: 'POST',
      body: JSON.stringify({ [ENTITY_ID_KEYS[entityType]]: entityId, rating }),
    });
  };

  return { setFavorite, setRating };
}
