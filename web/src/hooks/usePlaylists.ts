import { useQuery } from '@tanstack/react-query';
import type { Playlist } from '../types';
import { api } from '../lib/api.js';

export function usePlaylists({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<{ playlists: Playlist[] }, Error, Playlist[]>({
    queryKey: ['playlists'],
    queryFn: () => api('/playlists'),
    select: (data) => data.playlists,
    // Same 30s freshness convention as the library lists (useLibraryLists.ts);
    // without it every mount/sidebar navigation refetches (audit F29).
    staleTime: 30_000,
    enabled,
  });
}
