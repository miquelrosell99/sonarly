import type { components } from '../../../../contract/schema.js';
import type { Album, Song } from '../../../../types';
import type { SearchType } from '../../../../hooks/useLibraryLists.js';

export const validTypes: SearchType[] = ['songs', 'albums', 'artists', 'playlists'];

// The /search envelope carries display-subset DTOs (SearchSong/SearchAlbum/
// SearchArtist/SearchPlaylist), not full domain objects — the search page
// renders the subsets as-is and only widens at play/edit boundaries through
// the shared mappers (audit F17).
export type SearchAlbumItem = components['schemas']['SearchAlbum'];

export interface AlbumDetail {
  album: Album;
  songs: Song[];
}

export type PlaylistDetailWire = components['schemas']['PlaylistDetail'];

export function isValidType(value: string | null): value is SearchType {
  return !!value && (validTypes as string[]).includes(value);
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
