import { create } from 'zustand';

// Ephemeral Auto-DJ UI state bridging the engine (useAutoDj, mounted once in
// AudioController) and the queue UI: the engine owns the actual fetching, the
// queue section only signals intent. Deliberately not persisted — a refresh
// nonce must not survive a reload, and isFetching is a momentary status.
interface AutoDjUiState {
  /** Bumped by Refresh actions; the engine drops pending DJ picks and fetches a fresh batch. */
  refreshNonce: number;
  /** True while a batch request is in flight (queue section spinner). */
  isFetching: boolean;
  requestRefresh: () => void;
  setFetching: (fetching: boolean) => void;
}

export const useAutoDjUi = create<AutoDjUiState>()((set) => ({
  refreshNonce: 0,
  isFetching: false,
  requestRefresh: () => set((state) => ({ refreshNonce: state.refreshNonce + 1 })),
  setFetching: (fetching) => set({ isFetching: fetching }),
}));
