import type { FavoriteEntityType } from '@sonarly/shared';
import { api } from '../lib/api.js';

export interface FavoriteActions {
  setFavorite: (entityType: FavoriteEntityType, entityId: string, starred: boolean) => Promise<void>;
  setRating: (entityType: FavoriteEntityType, entityId: string, rating?: number) => Promise<void>;
}

export function useFavoriteActions(): FavoriteActions {
  const setFavorite = async (entityType: FavoriteEntityType, entityId: string, starred: boolean) => {
    await api('/favorites', {
      method: 'POST',
      body: JSON.stringify({ entityType, entityId, starred }),
    });
  };

  const setRating = async (entityType: FavoriteEntityType, entityId: string, rating?: number) => {
    await api('/ratings', {
      method: 'POST',
      body: JSON.stringify({ entityType, entityId, rating }),
    });
  };

  return { setFavorite, setRating };
}
