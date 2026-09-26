import type { SyncedLyricLine } from './song.js';

export interface LrcLibMatch {
  id: number;
  title: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
}

export interface LrcLibSearchResult {
  matches: LrcLibMatch[];
}
