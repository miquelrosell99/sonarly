import type { PlayerStore } from './types.js';
import { PREVIOUS_RESTART_THRESHOLD } from './utils.js';

type Set = (partial: Partial<PlayerStore>) => void;
type Get = () => PlayerStore;

/** Transport actions: play/pause/step/seek plus element-driven updates. */
export function createTransportSlice(set: Set, get: Get): Pick<PlayerStore, 'togglePlay' | 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'setDuration' | 'setCurrentTime' | 'setStatus' | 'onEnded' | 'updateCurrentSong'> {
  return {
    togglePlay: () => {
      const { status, play, pause } = get();
      if (status === 'playing') {
        pause();
      } else {
        play();
      }
    },

    play: () => {
      const { currentSong, status, playSession } = get();
      if (currentSong) {
        // Playing from idle restarts the current track from 0 (the element
        // rewound after `ended`), so it is a new play-through and scrobbling
        // must re-arm. Paused→playing resumes mid-track and element-driven
        // 'play' events fire mid-stream; neither may start a new session.
        set(
          status === 'idle'
            ? { status: 'playing', playSession: playSession + 1 }
            : { status: 'playing' },
        );
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
  };
}
