import { create } from 'zustand';
import type { Library } from '@sonarly/shared';
import { api } from '../api.js';

interface LibraryState {
  selectedLibraryId: string | null;
  libraries: Library[];
  isLoading: boolean;
  error: string | null;
  setSelectedLibraryId: (id: string | null) => void;
  setLibraries: (libraries: Library[]) => void;
  loadLibraries: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
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
}));

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
