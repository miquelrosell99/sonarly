import { create } from 'zustand';
import type { Song } from '../types';

export interface AddToPlaylistTarget {
  songs: Song[];
  /** Human description of the selection ("1 track", "12 tracks"). */
  label: string;
}

interface AddToPlaylistState {
  target: AddToPlaylistTarget | null;
  open: (songs: Song[], label?: string) => void;
  close: () => void;
}

// One global picker (mounted in App) instead of per-menu modal state: every
// context menu hook just calls open(), and the album/artist menus don't have
// to change their return shape for a hosted ReactNode.
export const useAddToPlaylistStore = create<AddToPlaylistState>((set) => ({
  target: null,
  open: (songs, label) =>
    set({
      target: {
        songs,
        label: label ?? (songs.length === 1 ? '1 track' : `${songs.length} tracks`),
      },
    }),
  close: () => set({ target: null }),
}));
