import type { PlayerStore } from './types.js';
import { buildShuffledIndices, shuffleArray } from './utils.js';

type Set = (partial: Partial<PlayerStore>) => void;
type Get = () => PlayerStore;

/** Queue-mutation actions: load a list, insert, append, prune. */
export function createQueueSlice(set: Set, get: Get): Pick<PlayerStore, 'playNow' | 'playQueue' | 'playAtIndex' | 'playNext' | 'addToQueue' | 'clearQueue' | 'removeAutoDjItems'> {
  return {
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
        playSession: get().playSession + 1,
      });
    },

    playQueue: (songs, startIndex, shuffle, context) => {
      // Library scans deactivate songs (duplicates, vanished files) while a
      // page may still hold a stale list; the stream endpoint refuses
      // inactive ids, so drop them instead of queueing tracks that can only
      // fail. An explicit start index refers to the caller's visible list —
      // remap it to the same song after filtering.
      const playable = songs.filter((song) => song.active !== false);
      const requested = startIndex !== undefined ? songs[startIndex] : undefined;
      let requestedIndex = startIndex;
      if (requested !== undefined) {
        const mapped = playable.findIndex((song) => song.id === requested.id);
        requestedIndex = mapped >= 0 ? mapped : 0;
      }
      const nextShuffle = shuffle ?? get().shuffle;
      let safeIndex: number;
      if (playable.length === 0) {
        safeIndex = 0;
      } else if (requestedIndex === undefined) {
        safeIndex = nextShuffle ? Math.floor(Math.random() * playable.length) : 0;
      } else {
        safeIndex = Math.max(0, Math.min(requestedIndex, playable.length - 1));
      }
      const currentSong = playable[safeIndex] ?? null;
      const shuffledIndices = nextShuffle && playable.length > 0
        ? buildShuffledIndices(playable.length, safeIndex)
        : [];
      set({
        queue: playable,
        queueIndex: safeIndex,
        currentSong,
        status: 'playing',
        currentTime: 0,
        duration: currentSong?.duration ?? 0,
        shuffle: nextShuffle,
        shuffledIndices,
        queueContext: context ?? null,
        playSession: get().playSession + 1,
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
        playSession: get().playSession + 1,
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
  };
}
