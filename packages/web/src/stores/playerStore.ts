import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@sonarly/shared';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type RepeatMode = 'off' | 'all' | 'one';

export type PlayerSong = Song & { artistName?: string; albumName?: string };

interface PlayerState {
  currentSong: PlayerSong | null;
  queue: PlayerSong[];
  queueIndex: number;
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  shuffledIndices: number[];
}

interface PlayerActions {
  playNow: (song: PlayerSong) => void;
  playQueue: (songs: PlayerSong[], startIndex?: number, shuffle?: boolean) => void;
  playNext: (song: PlayerSong) => void;
  addToQueue: (songs: PlayerSong[]) => void;
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
}

const initialState: PlayerState = {
  currentSong: null,
  queue: [],
  queueIndex: 0,
  status: 'idle',
  currentTime: 0,
  duration: 0,
  volume: 1,
  shuffle: false,
  repeat: 'off',
  shuffledIndices: [],
};

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildShuffledIndices(queueLength: number, currentIndex: number): number[] {
  if (queueLength === 0) return [];
  const others = Array.from({ length: queueLength }, (_, i) => i).filter((i) => i !== currentIndex);
  return [currentIndex, ...shuffleArray(others)];
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
        });
      },

      playQueue: (songs, startIndex = 0, shuffle) => {
        const safeIndex = songs.length === 0 ? 0 : Math.max(0, Math.min(startIndex, songs.length - 1));
        const currentSong = songs[safeIndex] ?? null;
        const nextShuffle = shuffle ?? get().shuffle;
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
        });
      },

      playNext: (song) => {
        const { queue, queueIndex, shuffle, shuffledIndices } = get();
        const insertAt = queueIndex + 1;
        const nextQueue = [...queue.slice(0, insertAt), song, ...queue.slice(insertAt)];
        let nextShuffled = shuffledIndices;
        if (shuffle) {
          const position = shuffledIndices.indexOf(queueIndex);
          nextShuffled = [
            ...shuffledIndices.slice(0, position + 1),
            nextQueue.length - 1,
            ...shuffledIndices.slice(position + 1).map((i) => (i >= insertAt ? i + 1 : i)),
          ];
        }
        set({ queue: nextQueue, shuffledIndices: nextShuffled });
      },

      addToQueue: (songs) => {
        const { queue, shuffle, shuffledIndices } = get();
        const nextQueue = [...queue, ...songs];
        let nextShuffled = shuffledIndices;
        if (shuffle) {
          const existingLength = queue.length;
          const newIndices = songs.map((_, i) => existingLength + i);
          nextShuffled = [...shuffledIndices, ...newIndices];
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
        const { queue, queueIndex, shuffle, shuffledIndices } = get();
        if (queue.length === 0) return;

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
        const { shuffle, queue, queueIndex } = get();
        const nextShuffle = !shuffle;
        const shuffledIndices = nextShuffle && queue.length > 0
          ? buildShuffledIndices(queue.length, queueIndex)
          : [];
        set({ shuffle: nextShuffle, shuffledIndices });
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
