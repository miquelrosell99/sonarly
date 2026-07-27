import { useEffect, useRef } from 'react';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';
import { usePreferences } from './usePreferences.js';
import { api } from '../api.js';

const DEFAULT_THRESHOLD = 5;
const DEFAULT_BATCH_SIZE = 10;
const MAX_EXCLUDE_IDS = 500;

export function useAutoDj() {
  const {
    currentSong,
    queue,
    queueIndex,
    addToQueue,
  } = usePlayer((state) => ({
    currentSong: state.currentSong,
    queue: state.queue,
    queueIndex: state.queueIndex,
    addToQueue: state.addToQueue,
  }));

  const { data: preferences } = usePreferences();
  const fetchingRef = useRef(false);

  const autoDjEnabled = preferences?.autoDjEnabled ?? false;
  const autoDjMode = preferences?.autoDjMode ?? 'smart';
  const threshold = preferences?.autoDjTopUpThreshold ?? DEFAULT_THRESHOLD;
  const batchSize = preferences?.autoDjBatchSize ?? DEFAULT_BATCH_SIZE;

  useEffect(() => {
    if (!autoDjEnabled || !currentSong) return;

    const remaining = queue.length - queueIndex - 1;
    if (remaining > threshold) return;
    if (fetchingRef.current) return;

    const recentQueueIds = queue.slice(-MAX_EXCLUDE_IDS).map((song) => song.id);
    const excludeIds = Array.from(new Set([currentSong.id, ...recentQueueIds]));
    const params = new URLSearchParams({
      currentSongId: currentSong.id,
      mode: autoDjMode,
      count: String(batchSize),
      excludeIds: excludeIds.join(','),
    });

    fetchingRef.current = true;
    api<{ songs: PlayerSong[] }>(`/playback/auto-dj?${params.toString()}`)
      .then(({ songs }) => {
        if (songs.length > 0) {
          addToQueue(songs);
        }
      })
      .catch(() => {
        // Silently ignore; playback continues.
      })
      .finally(() => {
        fetchingRef.current = false;
      });
  }, [
    autoDjEnabled,
    autoDjMode,
    currentSong,
    queue,
    queueIndex,
    threshold,
    batchSize,
    addToQueue,
  ]);
}
