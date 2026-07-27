import { useCallback, useEffect, useState } from 'react';
import type { Song } from '@sonarly/shared';
import { api } from '../api.js';
import { useFavoriteActions } from './useFavoriteActions.js';

export interface UseSongInteractionResult {
  starred?: boolean;
  rating?: number;
  setFavorite: (starred: boolean) => Promise<void>;
  setRating: (rating?: number) => Promise<void>;
}

export function useSongInteraction(
  songId: string | undefined,
  fallback: { starred?: boolean; rating?: number } = {},
): UseSongInteractionResult {
  const [starred, setStarred] = useState<boolean | undefined>(fallback.starred);
  const [rating, setRating] = useState<number | undefined>(fallback.rating);
  const { setFavorite: setFavoriteApi, setRating: setRatingApi } = useFavoriteActions();

  useEffect(() => {
    if (!songId) return;
    let cancelled = false;
    api<{ song: Song }>(`/songs/${songId}`)
      .then((res) => {
        if (cancelled) return;
        setStarred(res.song.starred);
        setRating(res.song.rating);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load song interaction', err);
      });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  const setFavorite = useCallback(
    async (nextStarred: boolean) => {
      if (!songId) return;
      const previousStarred = starred;
      setStarred(nextStarred);
      try {
        await setFavoriteApi('song', songId, nextStarred);
      } catch (err) {
        setStarred(previousStarred);
        console.error('Failed to update favorite', err);
        throw err;
      }
    },
    [songId, setFavoriteApi, starred],
  );

  const setRatingValue = useCallback(
    async (nextRating?: number) => {
      if (!songId) return;
      const previousRating = rating;
      setRating(nextRating);
      try {
        await setRatingApi('song', songId, nextRating);
      } catch (err) {
        setRating(previousRating);
        console.error('Failed to update rating', err);
        throw err;
      }
    },
    [songId, setRatingApi, rating],
  );

  return { starred, rating, setFavorite, setRating: setRatingValue };
}
