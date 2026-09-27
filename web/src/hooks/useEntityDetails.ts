// Server-state detail hooks for the entity detail pages (Track/Album/Artist)
// and the now-playing overlay's context resolution (P5). One key family per
// domain, so a detail page, the overlay, and any other consumer share one
// cache, and the SSE handler drops them by prefix on `library:changed` (see
// useServerEvents.ts — every key starts with an SSE-managed domain):
//
//   ['songs',   'detail', id, libraryId]  GET /songs/:id
//   ['albums',  'detail', id, libraryId]  GET /albums/:id   (embeds songs)
//   ['artists', 'detail', id, libraryId]  GET /artists/:id  (embeds songs)
//
// `libraryId` is the library-store scope; changing it changes the key, so a
// scope switch refetches exactly like the old hand-rolled effects did.
// Details are fresh for 30s, same as the lists (see useLibraryLists.ts).
//
// Favorite/rate edits patch the cached detail in place via `patchDetail` (the
// detail-page analog of the lists' `patchItem`); structural edits invalidate
// the domain prefixes through useLibraryMutation.
import { useCallback } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { components } from '../contract/schema.js';
import type { Album, Song } from '../types';
import { api } from '../lib/api.js';
import { buildLibraryQuery, useLibraryStore } from '../stores/libraryStore.js';

const STALE_TIME = 30_000;

// Response envelopes straight from the generated schema (plan 10d) — GET
// /songs/:id returns the Song DTO, GET /albums/:id the Album plus its full
// Songs, GET /artists/:id the Artist (with its album cards) plus Songs.
export interface SongDetailResponse {
  song: Song;
}

export interface AlbumDetailResponse {
  album: Album;
  songs: Song[];
}

/** Trimmed album card embedded in the artist detail response. */
export type ArtistAlbum = components['schemas']['ArtistAlbum'];

export interface ArtistDetailResponse {
  artist: components['schemas']['Artist'];
  songs: Song[];
}

export type DetailQueryResult<TResponse> = UseQueryResult<TResponse, Error> & {
  /**
   * Patch the cached detail in place (favorite/rate edits) without a refetch.
   * Shallow-merges into the cached response, so nested entities/lists are
   * replaced by the caller's merged copy (e.g. `{ song: { ...song, starred } }`,
   * `{ artist: { ...artist, albums: nextAlbums } }`) — the detail-page analog
   * of the lists' `patchItem`.
   */
  patchDetail: (patch: Partial<TResponse>) => void;
};

function useDetailQuery<TResponse>(
  domain: 'songs' | 'albums' | 'artists',
  id: string | undefined,
  enabled: boolean,
): DetailQueryResult<TResponse> {
  const queryClient = useQueryClient();
  const libraryId = useLibraryStore((state) => state.selectedLibraryId);
  const queryKey = [domain, 'detail', id ?? null, libraryId] as const;
  const query = useQuery<TResponse, Error>({
    queryKey,
    queryFn: () => api<TResponse>(`/${domain}/${id}${buildLibraryQuery(libraryId)}`),
    staleTime: STALE_TIME,
    enabled: !!id && enabled,
  });

  const patchDetail = useCallback(
    (patch: Partial<TResponse>) => {
      queryClient.setQueryData<TResponse>(queryKey, (old) => (old ? { ...old, ...patch } : old));
    },
    [queryClient, queryKey],
  );

  return { ...query, patchDetail };
}

export function useSongDetail(id: string | undefined, enabled = true) {
  return useDetailQuery<SongDetailResponse>('songs', id, enabled);
}

/** The album detail embeds its songs — one request, no separate songs fetch. */
export function useAlbumDetail(id: string | undefined, enabled = true) {
  return useDetailQuery<AlbumDetailResponse>('albums', id, enabled);
}

/**
 * The artist detail embeds both the artist's albums and the artist's songs
 * server-side (GET /artists/:id → `{artist, songs}`) — consuming the embedded
 * songs replaces the old parallel full-library `/songs` fetch and its 500-row
 * client filter (audit F16/F24).
 */
export function useArtistDetail(id: string | undefined, enabled = true) {
  return useDetailQuery<ArtistDetailResponse>('artists', id, enabled);
}
