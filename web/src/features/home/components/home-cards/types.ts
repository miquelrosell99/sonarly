import type { Album, Song } from '../../../../types';

/** One ranked genre: the name and its in-scope active song count. */
export interface HomeGenre {
  name: string;
  songCount: number;
}

/**
 * /api/home payload. `recentAdditions` is an ALBUM list ordered by the
 * newest in-scope song file mtime; `recentlyPlayed` is the caller's SONG
 * list (user_songs.last_played DESC) — both carry the caller's interaction
 * state, and mostPlayed/random stay album lists.
 */
export interface HomeData {
  genres: HomeGenre[];
  mostPlayed: Album[];
  random: Album[];
  recentAdditions: Album[];
  recentlyPlayed: Song[];
}

export interface AlbumDetail {
  album: Album;
  songs: Song[];
}
