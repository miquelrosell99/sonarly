import { useEffect, useRef } from 'react';
import { MAX_EXCLUDE_IDS } from '@sonarly/shared';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';
import { usePreferences } from './usePreferences.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { api } from '../api.js';

const DEFAULT_THRESHOLD = 5;
const DEFAULT_BATCH_SIZE = 10;

export function useAutoDj() {
  const {
    currentSong,
    queue,
    queueIndex,
    addToQueue,
    removeAutoDjItems,
  } = usePlayer((state) => ({
    currentSong: state.currentSong,
    queue: state.queue,
    queueIndex: state.queueIndex,
    addToQueue: state.addToQueue,
    removeAutoDjItems: state.removeAutoDjItems,
  }));

  const { data: preferences } = usePreferences();
  const { notify } = useNotification();
  const fetchingRef = useRef(false);

  const autoDjEnabled = preferences?.autoDjEnabled ?? false;
  const autoDjMode = preferences?.autoDjMode ?? 'smart';
  const threshold = preferences?.autoDjTopUpThreshold ?? DEFAULT_THRESHOLD;
  const batchSize = preferences?.autoDjBatchSize ?? DEFAULT_BATCH_SIZE;

  const prevEnabledRef = useRef(autoDjEnabled);
  const prevModeRef = useRef(autoDjMode);

  useEffect(() => {
    const wasEnabled = prevEnabledRef.current;
    const prevMode = prevModeRef.current;
    let needsRefill = false;

    if (wasEnabled && !autoDjEnabled) {
      removeAutoDjItems();
    } else if (wasEnabled && autoDjEnabled && prevMode !== autoDjMode) {
      removeAutoDjItems();
      needsRefill = true;
    }

    prevEnabledRef.current = autoDjEnabled;
    prevModeRef.current = autoDjMode;

    if (!autoDjEnabled || !currentSong) return;

    const store = usePlayer.getState();
    const remaining = store.queue.length - store.queueIndex - 1;
    if (!needsRefill && remaining > threshold) return;
    if (fetchingRef.current) return;

    const recentQueueIds = store.queue.slice(-MAX_EXCLUDE_IDS).map((song) => song.id);
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
          addToQueue(songs, { addedByAutoDj: true });
          notify(`${songs.length} ${songs.length === 1 ? 'song' : 'songs'} added to the queue`, 'info');
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
    removeAutoDjItems,
    notify,
  ]);
}
