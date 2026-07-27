import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type NowPlayingTab = 'queue' | 'lyrics';

interface NowPlayingState {
  isOpen: boolean;
  activeTab: NowPlayingTab;
}

interface NowPlayingActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setActiveTab: (tab: NowPlayingTab) => void;
}

const initialState: NowPlayingState = {
  isOpen: false,
  activeTab: 'queue',
};

export const useNowPlaying = create<NowPlayingState & NowPlayingActions>()(
  persist(
    (set) => ({
      ...initialState,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      setActiveTab: (tab) => set({ activeTab: tab }),
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
