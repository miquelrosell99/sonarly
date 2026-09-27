import { useQuery } from '@tanstack/react-query';
import type { components } from '../contract/schema.js';
import { api } from '../lib/api.js';
import { getShareToken, withShareToken } from '../lib/shareToken.js';

// Same 30s freshness convention as the library lists (useLibraryLists.ts);
// playlists are server state cached under one key family like the rest.
const STALE_TIME = 30_000;

/** GET /playlists/:id response, straight from the generated schema. */
export type PlaylistDetail = components['schemas']['PlaylistDetail'];

export function usePlaylist(id: string | undefined, enabled = true) {
  return useQuery<{ playlist: PlaylistDetail }, Error, PlaylistDetail>({
    queryKey: ['playlist', id, getShareToken()],
    queryFn: () => api(withShareToken(`/playlists/${id}`)),
    select: (data) => data.playlist,
    staleTime: STALE_TIME,
    enabled: !!id && enabled,
  });
}
