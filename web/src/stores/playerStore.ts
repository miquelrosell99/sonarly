import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { initialState, type PlayerStore } from './player/types.js';
import { createQueueSlice } from './player/queueSlice.js';
import { createTransportSlice } from './player/transportSlice.js';
import { createPrefsSlice } from './player/prefsSlice.js';
import { playerPersistOptions } from './player/persist.js';

export type {
  PlayerActions,
  PlayerSong,
  PlayerState,
  PlayerStatus,
  QueueContext,
  RepeatMode,
  SleepTimerState,
} from './player/types.js';
export { getNextSong } from './player/utils.js';

export const usePlayer = create<PlayerStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      ...createQueueSlice(set, get),
      ...createTransportSlice(set, get),
      ...createPrefsSlice(set, get),
    }),
    playerPersistOptions,
  )
);

export function resetPlayer(): void {
  usePlayer.setState({ ...initialState });
}
