import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '@sonarly/shared';
import { api } from '../lib/api.js';
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
  const songIdRef = useRef(songId);
  // Bumped on every optimistic mutation so a slower initial GET cannot
  // overwrite a fresher favorite/rating change.
  const mutationVersionRef = useRef(0);

  useEffect(() => {
    songIdRef.current = songId;
  }, [songId]);

  useEffect(() => {
    if (!songId) return;
    setStarred(fallback.starred);
    setRating(fallback.rating);
    let cancelled = false;
    const versionAtFetch = mutationVersionRef.current;
    api<{ song: Song }>(`/songs/${songId}`)
      .then((res) => {
        if (cancelled || versionAtFetch !== mutationVersionRef.current) return;
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
      const targetId = songId;
      const previousStarred = starred;
      mutationVersionRef.current += 1;
      setStarred(nextStarred);
      try {
        await setFavoriteApi('song', songId, nextStarred);
      } catch (err) {
        if (songIdRef.current === targetId) {
          setStarred(previousStarred);
        }
        console.error('Failed to update favorite', err);
        throw err;
      }
    },
    [songId, setFavoriteApi, starred],
  );

  const setRatingValue = useCallback(
    async (nextRating?: number) => {
      if (!songId) return;
      const targetId = songId;
      const previousRating = rating;
      mutationVersionRef.current += 1;
      setRating(nextRating);
      try {
        await setRatingApi('song', songId, nextRating);
      } catch (err) {
        if (songIdRef.current === targetId) {
          setRating(previousRating);
        }
        console.error('Failed to update rating', err);
        throw err;
      }
    },
    [songId, setRatingApi, rating],
  );

  return { starred, rating, setFavorite, setRating: setRatingValue };
}
