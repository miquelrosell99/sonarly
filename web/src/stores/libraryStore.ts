import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Client state only. The libraries list itself is server state and lives in
// react-query (useLibraries, key ['libraries']) since Phase 10e — this store
// holds just the user's library selection.
interface LibraryState {
  selectedLibraryId: string | null;
  setSelectedLibraryId: (id: string | null) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      selectedLibraryId: null,
      setSelectedLibraryId: (id) => set({ selectedLibraryId: id }),
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

export function buildLibraryQuery(libraryId: string | null): string {
  return libraryId ? `?libraryId=${encodeURIComponent(libraryId)}` : '';
}
