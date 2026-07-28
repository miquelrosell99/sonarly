import { useQuery } from '@tanstack/react-query';
import type { Playlist } from '@sonarly/shared';
import { api } from '../api.js';

export interface PlaylistDetailEntry {
  id: string;
  title: string;
  album: string;
  artist: string;
  track?: number;
  discNumber?: number;
  duration?: number;
  genre?: string;
  year?: number;
  explicit?: boolean;
  coverArt?: string;
}

export interface PlaylistDetail extends Playlist {
  songCount: number;
  entries: PlaylistDetailEntry[];
}

export function usePlaylist(id: string | undefined) {
  return useQuery<{ playlist: PlaylistDetail }, Error, PlaylistDetail>({
    queryKey: ['playlist', id],
    queryFn: () => api(`/playlists/${id}`),
    select: (data) => data.playlist,
    enabled: !!id,
  });
}
