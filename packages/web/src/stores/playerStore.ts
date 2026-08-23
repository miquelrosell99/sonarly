import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@sonarly/shared';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type RepeatMode = 'off' | 'all' | 'one';

export type SleepTimerState =
  | { mode: 'off' }
  | { mode: 'minutes'; endsAt: number }
  | { mode: 'endOfTrack' };

export type PlayerSong = Song & { artistName?: string; albumName?: string; addedByAutoDj?: boolean };

interface PlayerState {
  currentSong: PlayerSong | null;
  queue: PlayerSong[];
  queueIndex: number;
  queueContext: QueueContext | null;
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  shuffledIndices: number[];
  sleepTimer: SleepTimerState;
}

interface PlayerActions {
  playNow: (song: PlayerSong) => void;
  playQueue: (songs: PlayerSong[], startIndex?: number, shuffle?: boolean, context?: QueueContext) => void;
  playAtIndex: (index: number) => void;
  playNext: (song: PlayerSong | PlayerSong[]) => void;
  addToQueue: (songs: PlayerSong[], options?: { addedByAutoDj?: boolean }) => void;
  removeAutoDjItems: () => void;
  clearQueue: () => void;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  setStatus: (status: PlayerStatus) => void;
  onEnded: () => void;
  updateCurrentSong: (patch: Partial<PlayerSong>) => void;
  setSleepTimer: (timer: number | 'endOfTrack') => void;
  clearSleepTimer: () => void;
}

export interface QueueContext {
  type: 'playlist' | 'album' | 'genre';
  id: string;
}

const initialState: PlayerState = {
  currentSong: null,
  queue: [],
  queueIndex: 0,
  queueContext: null,
  status: 'idle',
  currentTime: 0,
  duration: 0,
  volume: 1,
  shuffle: false,
  repeat: 'off',
  shuffledIndices: [],
  sleepTimer: { mode: 'off' },
};

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const PREVIOUS_RESTART_THRESHOLD = 3;

function buildShuffledIndices(queueLength: number, currentIndex: number): number[] {
  if (queueLength === 0) return [];
  const others = Array.from({ length: queueLength }, (_, i) => i).filter((i) => i !== currentIndex);
  return [currentIndex, ...shuffleArray(others)];
}

/**
 * Read-only peek at what `next()` would play, honoring shuffle and repeat.
 * Used by the gapless preloader; repeat-one returns null because replaying
 * the current track needs no preload.
 */
export function getNextSong(
  state: Pick<PlayerState, 'queue' | 'queueIndex' | 'repeat' | 'shuffle' | 'shuffledIndices'>,
): PlayerSong | null {
  const { queue, queueIndex, repeat, shuffle, shuffledIndices } = state;
  if (queue.length === 0 || repeat === 'one') return null;

  if (shuffle) {
    const position = shuffledIndices.indexOf(queueIndex);
    if (position >= 0 && position + 1 < shuffledIndices.length) {
      return queue[shuffledIndices[position + 1]] ?? null;
    }
    return repeat === 'all' ? queue[shuffledIndices[0]] ?? null : null;
  }

  const nextIndex = queueIndex + 1;
  if (nextIndex < queue.length) return queue[nextIndex];
  return repeat === 'all' ? queue[0] : null;
}

export const usePlayer = create<PlayerState & PlayerActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      playNow: (song) => {
        const shuffledIndices = get().shuffle ? buildShuffledIndices(1, 0) : [];
        set({
          queue: [song],
          queueIndex: 0,
          currentSong: song,
          status: 'playing',
          currentTime: 0,
          duration: song.duration ?? 0,
          shuffledIndices,
          queueContext: null,
        });
      },

      playQueue: (songs, startIndex, shuffle, context) => {
        const nextShuffle = shuffle ?? get().shuffle;
        let safeIndex: number;
        if (songs.length === 0) {
          safeIndex = 0;
        } else if (startIndex === undefined) {
          safeIndex = nextShuffle ? Math.floor(Math.random() * songs.length) : 0;
        } else {
          safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
        }
        const currentSong = songs[safeIndex] ?? null;
        const shuffledIndices = nextShuffle && songs.length > 0
          ? buildShuffledIndices(songs.length, safeIndex)
          : [];
        set({
          queue: songs,
          queueIndex: safeIndex,
          currentSong,
          status: 'playing',
          currentTime: 0,
          duration: currentSong?.duration ?? 0,
          shuffle: nextShuffle,
          shuffledIndices,
          queueContext: context ?? null,
        });
      },

      playAtIndex: (index) => {
        const { queue } = get();
        if (queue.length === 0) return;
        const safeIndex = Math.max(0, Math.min(index, queue.length - 1));
        const song = queue[safeIndex] ?? null;
        set({
          queueIndex: safeIndex,
          currentSong: song,
          status: 'playing',
          currentTime: 0,
          duration: song?.duration ?? 0,
        });
      },

      playNext: (songs) => {
        const { queue, queueIndex, currentSong, shuffle, shuffledIndices } = get();
        const songsArray = Array.isArray(songs) ? songs : [songs];
        if (songsArray.length === 0) return;
        // With an empty queue (or no current song) there is no "next" slot;
        // start playback instead of stranding the songs.
        if (queue.length === 0 || !currentSong) {
          get().playQueue(songsArray, 0);
          return;
        }
        const insertAt = queueIndex + 1;
        const nextQueue = [...queue.slice(0, insertAt), ...songsArray, ...queue.slice(insertAt)];
        let nextShuffled = shuffledIndices;
        if (shuffle) {
          const position = shuffledIndices.indexOf(queueIndex);
          const newIndices = songsArray.map((_, i) => insertAt + i);
          const shuffledNewIndices = shuffleArray(newIndices);
          nextShuffled = [
            ...shuffledIndices.slice(0, position + 1),
            ...shuffledNewIndices,
            ...shuffledIndices.slice(position + 1).map((i) => (i >= insertAt ? i + songsArray.length : i)),
          ];
        }
        set({ queue: nextQueue, shuffledIndices: nextShuffled });
      },

      addToQueue: (songs, options) => {
        const { queue, currentSong, shuffle, shuffledIndices } = get();
        const markedSongs = options?.addedByAutoDj
          ? songs.map((song) => ({ ...song, addedByAutoDj: true as const }))
          : songs;
        // Appending to an empty queue would strand the songs with nothing
        // playing; start playback at the first one instead.
        if (queue.length === 0 || !currentSong) {
          if (markedSongs.length > 0) {
            get().playQueue(markedSongs, 0);
          }
          return;
        }
        const nextQueue = [...queue, ...markedSongs];
        let nextShuffled = shuffledIndices;
        if (shuffle && markedSongs.length > 0) {
          const existingLength = queue.length;
          const newIndices = markedSongs.map((_, i) => existingLength + i);
          nextShuffled = [...shuffledIndices, ...shuffleArray(newIndices)];
        }
        set({ queue: nextQueue, shuffledIndices: nextShuffled });
      },

      clearQueue: () => {
        const { currentSong, shuffle } = get();
        // Spotify-style: keep the current track playing, drop the rest.
        set({
          queue: currentSong ? [currentSong] : [],
          queueIndex: 0,
          shuffledIndices: shuffle ? [0] : [],
        });
      },

      removeAutoDjItems: () => {
        const { queue, queueIndex, shuffle, shuffledIndices } = get();
        const removedIndices = new Set<number>();
        const nextQueue = queue.filter((song, index) => {
          const remove = index > queueIndex && song.addedByAutoDj;
          if (remove) removedIndices.add(index);
          return !remove;
        });

        if (removedIndices.size === 0) return;

        let nextShuffled = shuffledIndices;
        if (shuffle) {
          nextShuffled = shuffledIndices
            .filter((index) => !removedIndices.has(index))
            .map((index) => {
              let offset = 0;
              for (const removed of removedIndices) {
                if (removed < index) offset += 1;
              }
              return index - offset;
            });
        }

        set({ queue: nextQueue, shuffledIndices: nextShuffled });
      },

      togglePlay: () => {
        const { status, play, pause } = get();
        if (status === 'playing') {
          pause();
        } else {
          play();
        }
      },

      play: () => {
        const { currentSong } = get();
        if (currentSong) {
          set({ status: 'playing' });
        }
      },

      pause: () => set({ status: 'paused' }),

      next: () => {
        const { queue, queueIndex, repeat, shuffle, shuffledIndices } = get();
        if (queue.length === 0) return;

        let nextIndex: number;
        if (shuffle) {
          const position = shuffledIndices.indexOf(queueIndex);
          const nextPosition = position + 1;
          if (nextPosition < shuffledIndices.length) {
            nextIndex = shuffledIndices[nextPosition];
          } else if (repeat === 'all') {
            nextIndex = shuffledIndices[0];
          } else {
            set({ status: 'idle' });
            return;
          }
        } else {
          nextIndex = queueIndex + 1;
          if (nextIndex >= queue.length) {
            if (repeat === 'all') {
              nextIndex = 0;
            } else {
              set({ status: 'idle' });
              return;
            }
          }
        }

        const nextSong = queue[nextIndex];
        set({
          queueIndex: nextIndex,
          currentSong: nextSong,
          status: 'playing',
          currentTime: 0,
          duration: nextSong?.duration ?? 0,
        });
      },

      previous: () => {
        const { queue, queueIndex, currentTime, shuffle, shuffledIndices, seek } = get();
        if (queue.length === 0) return;

        // Spotify-style: past the threshold, Previous restarts the track
        // regardless of whether playback is paused.
        if (currentTime > PREVIOUS_RESTART_THRESHOLD) {
          seek(0);
          return;
        }

        let prevIndex: number;
        if (shuffle) {
          const position = shuffledIndices.indexOf(queueIndex);
          const prevPosition = position - 1;
          if (prevPosition >= 0) {
            prevIndex = shuffledIndices[prevPosition];
          } else {
            return;
          }
        } else {
          prevIndex = queueIndex - 1;
          if (prevIndex < 0) return;
        }

        const prevSong = queue[prevIndex];
        set({
          queueIndex: prevIndex,
          currentSong: prevSong,
          status: 'playing',
          currentTime: 0,
          duration: prevSong?.duration ?? 0,
        });
      },

      seek: (seconds) => {
        const { duration } = get();
        const clamped = Math.max(0, Math.min(seconds, duration || seconds));
        set({ currentTime: clamped });
      },

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

      setDuration: (duration) => set({ duration: Math.max(0, duration) }),

      setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),

      setStatus: (status) => set({ status }),

      onEnded: () => {
        const { repeat } = get();
        if (repeat === 'one') {
          set({ currentTime: 0, status: 'playing' });
        } else {
          get().next();
        }
      },

      updateCurrentSong: (patch) => {
        const { currentSong, queue } = get();
        if (!currentSong) return;
        const updated = { ...currentSong, ...patch };
        set({
          currentSong: updated,
          queue: queue.map((song) => (song.id === updated.id ? { ...song, ...patch } : song)),
        });
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
    }),
    {
      name: 'sonarly-player',
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage;
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      partialize: (state) => ({
        queue: state.queue,
        queueIndex: state.queueIndex,
        queueContext: state.queueContext,
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat,
        shuffledIndices: state.shuffledIndices,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const persisted = state as PlayerState & PlayerActions;
        if (persisted.queue.length > 0 && persisted.queueIndex >= 0 && persisted.queueIndex < persisted.queue.length) {
          persisted.currentSong = persisted.queue[persisted.queueIndex];
        }
        persisted.status = 'idle';
        persisted.currentTime = 0;
        persisted.duration = 0;
      },
    }
  )
);

export function resetPlayer(): void {
  usePlayer.setState({ ...initialState });
}
