import type { PlayerStore, RepeatMode } from './types.js';
import { shuffleArray } from './utils.js';

type Set = (partial: Partial<PlayerStore>) => void;
type Get = () => PlayerStore;

/** User-preference actions: volume, shuffle, repeat, sleep timer. */
export function createPrefsSlice(set: Set, get: Get): Pick<PlayerStore, 'setVolume' | 'toggleShuffle' | 'cycleRepeat' | 'setSleepTimer' | 'clearSleepTimer'> {
  return {
    setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),

    toggleShuffle: () => {
      const { shuffle, queue, queueIndex, shuffledIndices } = get();
      const nextShuffle = !shuffle;

      if (!nextShuffle) {
        // Preserve the current shuffled order as the new queue order.
        if (shuffledIndices.length > 0) {
          const currentPosition = shuffledIndices.indexOf(queueIndex);
          if (currentPosition >= 0) {
            const nextQueue = shuffledIndices.map((i) => queue[i]);
            set({
              shuffle: false,
              shuffledIndices: [],
              queue: nextQueue,
              queueIndex: currentPosition,
              currentSong: nextQueue[currentPosition],
            });
            return;
          }
        }
        set({ shuffle: false, shuffledIndices: [] });
        return;
      }

      // Enabling shuffle: keep played/current items in place, reshuffle future items only.
      let nextShuffled: number[] = [];
      if (queue.length > 0) {
        const safeIndex = Math.max(0, Math.min(queueIndex, queue.length - 1));
        const playedAndCurrent = Array.from({ length: safeIndex + 1 }, (_, i) => i);
        const future = Array.from({ length: queue.length - safeIndex - 1 }, (_, i) => safeIndex + 1 + i);
        nextShuffled = [...playedAndCurrent, ...shuffleArray(future)];
      }
      set({ shuffle: true, shuffledIndices: nextShuffled });
    },

    cycleRepeat: () => {
      const { repeat } = get();
      const order: RepeatMode[] = ['off', 'all', 'one'];
      const nextIndex = (order.indexOf(repeat) + 1) % order.length;
      set({ repeat: order[nextIndex] });
    },

    setSleepTimer: (timer) => {
      if (timer === 'endOfTrack') {
        set({ sleepTimer: { mode: 'endOfTrack' } });
      } else {
        const minutes = Math.max(0, timer);
        set({ sleepTimer: { mode: 'minutes', endsAt: Date.now() + minutes * 60_000 } });
      }
    },

    clearSleepTimer: () => set({ sleepTimer: { mode: 'off' } }),
  };
}
