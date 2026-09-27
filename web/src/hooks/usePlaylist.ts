import { useQuery } from '@tanstack/react-query';
import type { components } from '../contract/schema.js';
import { api } from '../lib/api.js';
import { getShareToken, withShareToken } from '../lib/shareToken.js';
import { LIBRARY_LIST_STALE_TIME } from './useLibraryLists.js';

/** GET /playlists/:id response, straight from the generated schema. */
export type PlaylistDetail = components['schemas']['PlaylistDetail'];

export function usePlaylist(id: string | undefined, enabled = true) {
  return useQuery<{ playlist: PlaylistDetail }, Error, PlaylistDetail>({
    queryKey: ['playlist', id, getShareToken()],
    queryFn: () => api(withShareToken(`/playlists/${id}`)),
    select: (data) => data.playlist,
    staleTime: LIBRARY_LIST_STALE_TIME,
    enabled: !!id && enabled,
  });
}
