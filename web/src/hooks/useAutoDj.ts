import { useEffect, useRef } from 'react';
import { MAX_EXCLUDE_IDS, MAX_QUEUE_IDS } from '../types';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';
import { useAutoDjUi } from '../stores/autoDjStore.js';
import { usePreferences } from './usePreferences.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { api } from '../lib/api.js';

const DEFAULT_THRESHOLD = 5;
const DEFAULT_BATCH_SIZE = 10;
// Mirror of the AudioController gapless-preload window: when the queued
// tracks drain inside it, the batch request must already be in flight or the
// preloader has nothing to warm and the transition stalls.
const GAPLESS_PRELOAD_SECONDS = 30;

type AutoDjResponseSong = PlayerSong & { reason?: string };

// Sum the durations of the upcoming tracks; true when the queue drains
// inside the gapless window. A track without a known duration makes the sum
// unknowable — the count-based threshold stays the only trigger then.
function drainsWithin(upcoming: PlayerSong[], seconds: number): boolean {
  let total = 0;
  for (const song of upcoming) {
    if (song.duration == null) return false;
    total += song.duration;
  }
  return total <= seconds;
}

function collectPendingDjIds(): string[] {
  const store = usePlayer.getState();
  return store.queue
    .slice(store.queueIndex + 1)
    .filter((song) => song.addedByAutoDj)
    .map((song) => song.id);
}

export function useAutoDj() {
  const currentSong = usePlayer((state) => state.currentSong);
  const queue = usePlayer((state) => state.queue);
  const queueIndex = usePlayer((state) => state.queueIndex);
  const addToQueue = usePlayer((state) => state.addToQueue);
  const removeAutoDjItems = usePlayer((state) => state.removeAutoDjItems);

  const { data: preferences } = usePreferences();
  const { notify } = useNotification();
  const refreshNonce = useAutoDjUi((state) => state.refreshNonce);
  const setFetching = useAutoDjUi((state) => state.setFetching);
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
  const prevRefreshNonceRef = useRef(refreshNonce);

  useEffect(() => {
    const wasEnabled = prevEnabledRef.current;
    const prevConfigKey = prevConfigKeyRef.current;
    const prevRefreshNonce = prevRefreshNonceRef.current;
    // Ids of the DJ picks about to be dropped: they join the request's
    // exclusion lists so a refresh batch is disjoint from what it replaced
    // (the server is stateless — freshness comes from the caller's lists).
    let removedDjIds: string[] = [];
    let needsRefill = false;

    if (wasEnabled && !autoDjEnabled) {
      removeAutoDjItems();
      generationRef.current += 1;
    } else if (wasEnabled && autoDjEnabled && prevConfigKey !== configKey) {
      removedDjIds = collectPendingDjIds();
      removeAutoDjItems();
      needsRefill = true;
      generationRef.current += 1;
    } else if (autoDjEnabled && prevRefreshNonce !== refreshNonce) {
      removedDjIds = collectPendingDjIds();
      removeAutoDjItems();
      needsRefill = true;
      generationRef.current += 1;
    }

    prevEnabledRef.current = autoDjEnabled;
    prevConfigKeyRef.current = configKey;
    prevRefreshNonceRef.current = refreshNonce;

    if (!autoDjEnabled || !currentSong) return;

    const store = usePlayer.getState();
    const upcoming = store.queue.slice(store.queueIndex + 1);
    const remaining = upcoming.length;
    // Fetch when the count threshold trips OR when the queue would drain
    // inside the gapless preload window — whichever comes first.
    if (!needsRefill && remaining > threshold && !drainsWithin(upcoming, GAPLESS_PRELOAD_SECONDS)) {
      return;
    }
    if (fetchingRef.current) return;

    // The dropped DJ picks go first: they are no longer in the queue, so
    // queueIds cannot cover them — a refresh must never repeat them.
    const recentQueueIds = store.queue.slice(-MAX_EXCLUDE_IDS).map((song) => song.id);
    const excludeIds = Array.from(new Set([...removedDjIds, currentSong.id, ...recentQueueIds])).slice(
      0,
      MAX_EXCLUDE_IDS,
    );
    // The full queue backs the server's hard duplicate guarantee; the tail
    // doubles as the similarity-seed fallback server-side.
    const queueIds = store.queue.map((song) => song.id).slice(-MAX_QUEUE_IDS);

    fetchingRef.current = true;
    setFetching(true);
    // Capture the generation so a result arriving after Auto DJ was disabled,
    // the DJ config changed, or a newer refresh started is dropped instead of
    // polluting the queue.
    const generation = generationRef.current;
    api<{ songs: AutoDjResponseSong[] }>('/playback/auto-dj', {
      method: 'POST',
      body: JSON.stringify({
        currentSongId: currentSong.id,
        mode: autoDjMode,
        count: batchSize,
        excludeIds,
        queueIds,
      }),
    })
      .then(({ songs }) => {
        if (generation !== generationRef.current) return;
        if (songs.length > 0) {
          // Carry the server explanation onto the queue row for the UI.
          const withReasons = songs.map((song) => ({ ...song, autoDjReason: song.reason }));
          addToQueue(withReasons, { addedByAutoDj: true });
          notify(`${songs.length} ${songs.length === 1 ? 'song' : 'songs'} added to the queue`, 'info');
          // Seamlessness: if the queue drained to idle while the request was
          // in flight, advance into the first new track instead of stopping.
          const after = usePlayer.getState();
          if (after.status === 'idle' && after.currentSong) {
            after.next();
          }
        }
      })
      .catch((err: unknown) => {
        // Q7 resolved "notify": a failed top-up must not fail silently while
        // successes toast — playback continues regardless.
        notify(err instanceof Error ? err.message : 'Auto DJ could not add songs', 'error');
      })
      .finally(() => {
        fetchingRef.current = false;
        setFetching(false);
      });
  }, [
    autoDjEnabled,
    autoDjMode,
    configKey,
    refreshNonce,
    currentSong,
    queue,
    queueIndex,
    threshold,
    batchSize,
    addToQueue,
    removeAutoDjItems,
    notify,
    setFetching,
  ]);
}
