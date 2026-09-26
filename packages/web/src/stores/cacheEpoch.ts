// Cache epoch for hand-rolled (non-react-query) data pages.
//
// The SSE handler bumps this counter on every `library:changed` event, in
// addition to invalidating react-query prefixes and dispatching the window
// event. Hand-rolled pages that hold server data in useState add `epoch` to
// their fetch effect's dependency array, so a scan/ingest/organize refreshes
// them exactly like it already refreshes react-query consumers. This is the
// minimal-diff bridge until the full react-query unification lands (audit
// FF1, Phase 1).
import { create } from 'zustand';

interface CacheEpochState {
  epoch: number;
  bump: () => void;
}

export const useCacheEpochStore = create<CacheEpochState>((set) => ({
  epoch: 0,
  bump: () => set((state) => ({ epoch: state.epoch + 1 })),
}));

/** Subscribe to the epoch from a component (add it to the fetch effect deps). */
export function useCacheEpoch(): number {
  return useCacheEpochStore((state) => state.epoch);
}

/** Bump the epoch from non-React code (the SSE handler). */
export function bumpCacheEpoch(): void {
  useCacheEpochStore.getState().bump();
}

/** Test helper: reset to the initial epoch. */
export function resetCacheEpoch(): void {
  useCacheEpochStore.setState({ epoch: 0 });
}
