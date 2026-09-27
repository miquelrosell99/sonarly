// Server-state list hooks for the library domains (FF1 react-query unification).
//
// Every list a library page renders comes from one query-key family per
// domain so pages share a cache and the SSE handler can drop them all by
// prefix on `library:changed` (see useServerEvents.ts):
//
//   ['songs',   'list', params]   /songs
//   ['albums',  'list', params]   /albums
//   ['artists', 'list', params]   /artists
//   ['genres',  'list', params]   /genres
//   ['years',   'list', params]   /years
//   ['libraries']                 /libraries (sidebar/TopBar selector;
//                                 refreshed via the sonarly:library-changed
//                                 DOM bridge, see useLibraries below)
//   ['search',  'preview', …]     /search?q=…&limit=5 (SearchBox dropdown)
//   ['search',  'results', …]     /search?q=…&type=…  (/search page; adopts a
//                                 matching preview entry as initialData)
//
// Playlists live in usePlaylists/usePlaylist ('playlists' / ['playlist', id]).
// `params` holds only what the server sees (library scope plus the server
// filters genre/composer/label); client-side-only filters stay derived state
// in the page and never enter the key. Filter/scope changes refetch under a
// new key while `placeholderData: keepPreviousData` keeps the current list on
// screen — no spinner flash.
//
// Lists are fresh for 30s (staleTime); after that a remount refetches in the
// background. Favorite/rate/tag edits patch the cached item in place via
// `patchItem` so the UI updates without a refetch, exactly like the old
// hand-rolled setState did.
import { useCallback, useEffect } from 'react';
import { keepPreviousData, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { components } from '../contract/schema.js';
import type { Album, Artist, Library, Playlist, Song } from '../types';
import { api } from '../lib/api.js';

export const LIBRARY_LIST_STALE_TIME = 30_000;

export interface LibrariesResponse {
  libraries: Library[];
}

/**
 * The libraries list backing the sidebar/TopBar selector — server state that
 * lived in libraryStore until Phase 10e retired that copy. Keyed ['libraries']
 * so admin CRUD (`AdminLibraries`) can target it by exact key.
 *
 * The P4-era TopBar refresh is consolidated here: the sonarly:library-changed
 * DOM bridge (dispatched by useServerEvents on SSE library:changed and on
 * EventSource reconnect) invalidates the key, so every mounted selector
 * refetches and admin CRUD shows up without a reload. Guests never mount a
 * consumer of this hook (Layout requires a user), so share-link flows never
 * fetch /libraries.
 */
export function useLibraries(enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
    };
    window.addEventListener('sonarly:library-changed', refresh);
    return () => window.removeEventListener('sonarly:library-changed', refresh);
  }, [queryClient]);

  return useQuery<LibrariesResponse, Error>({
    queryKey: ['libraries'],
    queryFn: () => api<LibrariesResponse>('/libraries'),
    staleTime: LIBRARY_LIST_STALE_TIME,
    enabled,
  });
}

export interface LibraryListParams {
  libraryId?: string | null;
  genre?: string;
  composer?: string;
  label?: string;
}

function buildListQueryString(params: LibraryListParams): string {
  const search = new URLSearchParams();
  if (params.libraryId) search.set('libraryId', params.libraryId);
  if (params.genre) search.set('genre', params.genre);
  if (params.composer) search.set('composer', params.composer);
  if (params.label) search.set('label', params.label);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function listKey(domain: string, params: LibraryListParams): readonly unknown[] {
  return [domain, 'list', { ...params }];
}

export type ListQueryResult<TResponse, TItem> = UseQueryResult<TResponse, Error> & {
  /** Patch one cached item in place (favorite/rate edits) without a refetch. */
  patchItem: (id: string, patch: Partial<TItem>) => void;
};

function useListQuery<TResponse, TItem extends { id: string }>(
  domain: 'songs' | 'albums' | 'artists' | 'genres' | 'years',
  responseKey: keyof TResponse & string,
  path: string,
  params: LibraryListParams,
  enabled = true,
): ListQueryResult<TResponse, TItem> {
  const queryClient = useQueryClient();
  const queryKey = listKey(domain, params);
  const url = `${path}${buildListQueryString(params)}`;
  const query = useQuery<TResponse, Error>({
    queryKey,
    queryFn: () => api<TResponse>(url),
    staleTime: LIBRARY_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
    enabled,
  });

  const patchItem = useCallback(
    (id: string, patch: Partial<TItem>) => {
      queryClient.setQueryData<TResponse>(queryKey, (old) => {
        if (!old) return old;
        const record = old as Record<string, unknown[]>;
        const list = record[responseKey] as TItem[];
        return {
          ...record,
          [responseKey]: list.map((item) => (item.id === id ? ({ ...item, ...patch } as TItem) : item)),
        } as TResponse;
      });
    },
    [queryClient, queryKey, responseKey],
  );

  return { ...query, patchItem };
}

export interface SongsResponse {
  songs: Song[];
}

export function useSongsList(params: LibraryListParams = {}, enabled = true) {
  return useListQuery<SongsResponse, Song>('songs', 'songs', '/songs', params, enabled);
}

export interface AlbumsResponse {
  albums: Album[];
}

export function useAlbumsList(params: LibraryListParams = {}, enabled = true) {
  return useListQuery<AlbumsResponse, Album>('albums', 'albums', '/albums', params, enabled);
}

export interface ArtistsResponse {
  artists: Artist[];
}

export function useArtistsList(params: LibraryListParams = {}, enabled = true) {
  return useListQuery<ArtistsResponse, Artist>('artists', 'artists', '/artists', params, enabled);
}

export interface GenreListItem {
  id: string;
  name: string;
  path: string;
}

export interface GenresResponse {
  genres: GenreListItem[];
}

export function useGenresList(params: LibraryListParams = {}) {
  return useListQuery<GenresResponse, GenreListItem>('genres', 'genres', '/genres', params);
}

/** One distinct year of in-scope active songs and how many songs carry it. */
export interface YearCount {
  year: number;
  songCount: number;
}

export interface YearsResponse {
  years: YearCount[];
}

/** Years are read-only aggregates; nothing patches them in place. */
export function useYearsList(params: LibraryListParams = {}) {
  const queryKey = listKey('years', params);
  const url = `/years${buildListQueryString(params)}`;
  return useQuery<YearsResponse, Error>({
    queryKey,
    queryFn: () => api<YearsResponse>(url),
    staleTime: LIBRARY_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  });
}

export type SearchResultsResponse = components['schemas']['SearchResults'];

export type SearchType = 'songs' | 'albums' | 'artists' | 'playlists';

/**
 * Top-5 preview for the SearchBox dropdown, keyed ['search','preview',…] —
 * the same /search envelope as the results page, one family under the 'search'
 * prefix so SSE invalidation covers both and the results query can adopt it
 * without re-downloading (see useSearchResults).
 */
export function useSearchPreview(query: string, libraryId: string | null) {
  return useQuery<SearchResultsResponse, Error>({
    queryKey: ['search', 'preview', { q: query, libraryId }],
    queryFn: () =>
      api<SearchResultsResponse>(
        `/search?q=${encodeURIComponent(query)}&limit=5${libraryId ? `&libraryId=${encodeURIComponent(libraryId)}` : ''}`,
      ),
    enabled: query.trim().length > 0,
    staleTime: LIBRARY_LIST_STALE_TIME,
  });
}

/**
 * Full search results for the /search page. The debounce lives upstream in
 * SearchBox (200ms before the `?q=` param even changes); once the param
 * changes the fetch is immediate, matching the old hand-rolled effect.
 *
 * When the dropdown preview for the same q + library scope is already cached,
 * it seeds this query (initialData, with the preview's own dataUpdatedAt so a
 * stale preview still refetches): pressing Enter after a preview shows the
 * results instantly and does not re-download them. `keepPreviousData` still
 * applies to every later key change.
 */
export function useSearchResults(query: string, type: SearchType, libraryId: string | null) {
  const queryClient = useQueryClient();
  const previewState = queryClient.getQueryState(['search', 'preview', { q: query, libraryId }]);
  const preview = previewState?.data as SearchResultsResponse | undefined;

  return useQuery<SearchResultsResponse, Error>({
    queryKey: ['search', 'results', { q: query, type, libraryId }],
    queryFn: () =>
      api<SearchResultsResponse>(
        `/search?q=${encodeURIComponent(query)}&type=${type}${libraryId ? `&libraryId=${encodeURIComponent(libraryId)}` : ''}`,
      ),
    enabled: query.trim().length > 0,
    staleTime: LIBRARY_LIST_STALE_TIME,
    initialData: preview,
    initialDataUpdatedAt: previewState?.dataUpdatedAt,
    placeholderData: keepPreviousData,
  });
}
