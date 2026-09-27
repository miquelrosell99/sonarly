import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type NowPlayingTab = 'queue' | 'lyrics';

interface NowPlayingState {
  isOpen: boolean;
  activeTab: NowPlayingTab;
  // Where to navigate when the overlay closes after a URL-driven open.
  returnPath: string | null;
  // One-shot flag for the scroll-restoration hook (audit F8): the overlay's
  // open/close navigations swap the URL while the page underneath keeps its
  // scroll position, so the next location change must restore the remembered
  // offset instead of resetting to the top. Set right before the overlay's
  // navigations, consumed by useScrollRestoration on the next location change.
  suppressNextReset: boolean;
}

interface NowPlayingActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setActiveTab: (tab: NowPlayingTab) => void;
  setReturnPath: (path: string | null) => void;
  setSuppressNextReset: (suppress: boolean) => void;
}

const initialState: NowPlayingState = {
  isOpen: false,
  activeTab: 'queue',
  returnPath: null,
  suppressNextReset: false,
};

export const useNowPlaying = create<NowPlayingState & NowPlayingActions>()(
  persist(
    (set) => ({
      ...initialState,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setReturnPath: (path) => set({ returnPath: path }),
      setSuppressNextReset: (suppress) => set({ suppressNextReset: suppress }),
    }),
    {
      name: 'sonarly-now-playing',
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
      partialize: (state) => ({ activeTab: state.activeTab }),
    }
  )
);

export function resetNowPlaying(): void {
  useNowPlaying.setState({ ...initialState });
}
