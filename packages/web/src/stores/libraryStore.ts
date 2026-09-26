import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Library } from '@sonarly/shared';
import { api } from '../lib/api.js';

interface LibraryState {
  selectedLibraryId: string | null;
  libraries: Library[];
  isLoading: boolean;
  error: string | null;
  setSelectedLibraryId: (id: string | null) => void;
  setLibraries: (libraries: Library[]) => void;
  loadLibraries: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      selectedLibraryId: null,
      libraries: [],
      isLoading: false,
      error: null,
      setSelectedLibraryId: (id) => set({ selectedLibraryId: id }),
      setLibraries: (libraries) => set({ libraries }),
      loadLibraries: async () => {
        set({ isLoading: true, error: null });
        try {
          const { libraries } = await api<{ libraries: Library[] }>('/libraries');
          set({ libraries, isLoading: false });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to load libraries', isLoading: false });
          throw err;
        }
      },
    }),
    {
      name: 'sonarly-library',
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
      // FF7: only the selection is user preference; the libraries list is
      // server state and must not survive in storage.
      partialize: (state) => ({ selectedLibraryId: state.selectedLibraryId }),
    },
  ),
);

export function getSelectedLibraryId(): string | null {
  return useLibraryStore.getState().selectedLibraryId;
}

export function getSelectedLibrary(): Library | undefined {
  const { selectedLibraryId, libraries } = useLibraryStore.getState();
  if (!selectedLibraryId) return undefined;
  return libraries.find((l) => l.id === selectedLibraryId);
}

export function buildLibraryQuery(libraryId: string | null): string {
  return libraryId ? `?libraryId=${encodeURIComponent(libraryId)}` : '';
}
