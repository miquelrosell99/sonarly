import { useEffect, useRef } from 'react';
import { MAX_EXCLUDE_IDS } from '@sonarly/shared';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';
import { usePreferences } from './usePreferences.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { api } from '../lib/api.js';

const DEFAULT_THRESHOLD = 5;
const DEFAULT_BATCH_SIZE = 10;

export function useAutoDj() {
  const currentSong = usePlayer((state) => state.currentSong);
  const queue = usePlayer((state) => state.queue);
  const queueIndex = usePlayer((state) => state.queueIndex);
  const addToQueue = usePlayer((state) => state.addToQueue);
  const removeAutoDjItems = usePlayer((state) => state.removeAutoDjItems);

  const { data: preferences } = usePreferences();
  const { notify } = useNotification();
  const fetchingRef = useRef(false);
  const generationRef = useRef(0);

  const autoDjEnabled = preferences?.autoDjEnabled ?? false;
  const autoDjMode = preferences?.autoDjMode ?? 'smart';
  const threshold = preferences?.autoDjTopUpThreshold ?? DEFAULT_THRESHOLD;
  const batchSize = preferences?.autoDjBatchSize ?? DEFAULT_BATCH_SIZE;

  // Any change to these invalidates pending DJ picks: they shape which
  // candidates the server selects, so queued DJ items would be stale.
  const configKey = [
    autoDjMode,
    preferences?.autoDjExcludeWindow ?? '24h',
    preferences?.autoDjPreferFavorites ? 'fav' : 'any',
    preferences?.autoDjDiscovery ?? 50,
  ].join('|');

  const prevEnabledRef = useRef(autoDjEnabled);
  const prevConfigKeyRef = useRef(configKey);

  useEffect(() => {
    const wasEnabled = prevEnabledRef.current;
    const prevConfigKey = prevConfigKeyRef.current;
    let needsRefill = false;

    if (wasEnabled && !autoDjEnabled) {
      removeAutoDjItems();
      generationRef.current += 1;
    } else if (wasEnabled && autoDjEnabled && prevConfigKey !== configKey) {
      removeAutoDjItems();
      needsRefill = true;
      generationRef.current += 1;
    }

    prevEnabledRef.current = autoDjEnabled;
    prevConfigKeyRef.current = configKey;

    if (!autoDjEnabled || !currentSong) return;

    const store = usePlayer.getState();
    const remaining = store.queue.length - store.queueIndex - 1;
    if (!needsRefill && remaining > threshold) return;
    if (fetchingRef.current) return;

    const recentQueueIds = store.queue.slice(-MAX_EXCLUDE_IDS).map((song) => song.id);
    const excludeIds = Array.from(new Set([currentSong.id, ...recentQueueIds])).slice(
      0,
      MAX_EXCLUDE_IDS,
    );

    fetchingRef.current = true;
    // Capture the generation so a result arriving after Auto DJ was disabled
    // or the DJ config changed is dropped instead of polluting the queue.
    const generation = generationRef.current;
    api<{ songs: PlayerSong[] }>('/playback/auto-dj', {
      method: 'POST',
      body: JSON.stringify({
        currentSongId: currentSong.id,
        mode: autoDjMode,
        count: batchSize,
        excludeIds,
      }),
    })
      .then(({ songs }) => {
        if (generation !== generationRef.current) return;
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
    configKey,
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
