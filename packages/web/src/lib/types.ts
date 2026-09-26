import type { Song } from '../types';

export type SongWithNames = Song & {
  artistName?: string;
  albumName?: string;
  albumArtistName?: string;
};
