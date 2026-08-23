import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type NowPlayingTab = 'queue' | 'lyrics';

interface NowPlayingState {
  isOpen: boolean;
  activeTab: NowPlayingTab;
  // Where to navigate when the overlay closes after a URL-driven open.
  returnPath: string | null;
}

interface NowPlayingActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setActiveTab: (tab: NowPlayingTab) => void;
  setReturnPath: (path: string | null) => void;
}

const initialState: NowPlayingState = {
  isOpen: false,
  activeTab: 'queue',
  returnPath: null,
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
