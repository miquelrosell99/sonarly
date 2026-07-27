import type { Song } from '@sonarly/shared';

export type SongWithNames = Song & {
  artistName?: string;
  albumName?: string;
  albumArtistName?: string;
};
