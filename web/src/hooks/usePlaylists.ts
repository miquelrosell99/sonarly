import { useQuery } from '@tanstack/react-query';
import type { Playlist } from '../types';
import { api } from '../lib/api.js';

export function usePlaylists({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<{ playlists: Playlist[] }, Error, Playlist[]>({
    queryKey: ['playlists'],
    queryFn: () => api('/playlists'),
    select: (data) => data.playlists,
    enabled,
  });
}
