import { useQuery } from '@tanstack/react-query';
import type { Playlist } from '@sonarly/shared';
import { api } from '../lib/api.js';

export function usePlaylists() {
  return useQuery<{ playlists: Playlist[] }, Error, Playlist[]>({
    queryKey: ['playlists'],
    queryFn: () => api('/playlists'),
    select: (data) => data.playlists,
  });
}
