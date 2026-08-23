import { useQuery } from '@tanstack/react-query';
import type { Playlist } from '@sonarly/shared';
import { api } from '../lib/api.js';
import { getShareToken, withShareToken } from '../lib/shareToken.js';

export interface PlaylistDetailEntry {
  id: string;
  title: string;
  album: string;
  albumId?: string;
  artist: string;
  artistId?: string;
  artistEntries?: { id: string; name: string }[];
  track?: number;
  discNumber?: number;
  duration?: number;
  genre?: string;
  year?: number;
  explicit?: boolean;
  coverArt?: string;
  albumCoverArt?: string;
}

export interface PlaylistDetail extends Playlist {
  songCount: number;
  entries: PlaylistDetailEntry[];
}

export function usePlaylist(id: string | undefined) {
  return useQuery<{ playlist: PlaylistDetail }, Error, PlaylistDetail>({
    queryKey: ['playlist', id, getShareToken()],
    queryFn: () => api(withShareToken(`/playlists/${id}`)),
    select: (data) => data.playlist,
    enabled: !!id,
  });
}
