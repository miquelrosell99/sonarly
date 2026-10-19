import type { Song } from '../../types';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type RepeatMode = 'off' | 'all' | 'one';

export type SleepTimerState =
  | { mode: 'off' }
  | { mode: 'minutes'; endsAt: number }
  | { mode: 'endOfTrack' };

export type PlayerSong = Song & {
  artistName?: string;
  albumName?: string;
  addedByAutoDj?: boolean;
  /** Server-computed explanation for an Auto-DJ pick ("More like X", …). */
  autoDjReason?: string;
};

export interface QueueContext {
  type: 'playlist' | 'album' | 'genre' | 'composer' | 'label';
  id: string;
}

export interface PlayerState {
  currentSong: PlayerSong | null;
  queue: PlayerSong[];
  queueIndex: number;
  queueContext: QueueContext | null;
  status: PlayerStatus;
  // Monotonic counter bumped whenever a user action starts a new play-through
  // of a track (even the same track again). AudioController subscribes to it
  // to re-arm its per-track scrobbles; deliberately not persisted.
  playSession: number;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  shuffledIndices: number[];
  sleepTimer: SleepTimerState;
}

export interface PlayerActions {
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

export type PlayerStore = PlayerState & PlayerActions;

export const initialState: PlayerState = {
  currentSong: null,
  queue: [],
  queueIndex: 0,
  queueContext: null,
  status: 'idle',
  playSession: 0,
  currentTime: 0,
  duration: 0,
  volume: 1,
  shuffle: false,
  repeat: 'off',
  shuffledIndices: [],
  sleepTimer: { mode: 'off' },
};
