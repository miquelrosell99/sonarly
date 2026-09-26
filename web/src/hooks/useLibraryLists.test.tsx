import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useSearchPreview,
  useSearchResults,
  type SearchResultsResponse,
} from './useLibraryLists.js';
import { createTestQueryClient } from '../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const previewData: SearchResultsResponse = {
  songs: [{ id: 'song-1', title: 'Alpha Song' }],
  albums: [{ id: 'album-1', name: 'Alpha Album' }],
  artists: [],
  playlists: [],
};

function hookWrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSearchPreview', () => {
  it('fetches the top-5 preview under the shared search family', async () => {
    mockApi.mockResolvedValue(previewData);
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useSearchPreview('alpha', null), {
      wrapper: hookWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi).toHaveBeenCalledWith('/search?q=alpha&limit=5');
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
      .filter((key) => key[0] === 'search');
    expect(keys).toEqual([['search', 'preview', { q: 'alpha', libraryId: null }]]);
  });

  it('does not fetch while the query is empty', () => {
    mockApi.mockResolvedValue(previewData);
    const { result } = renderHook(() => useSearchPreview('', null), {
      wrapper: hookWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('useSearchResults (preview adoption)', () => {
  it('serves a matching preview without re-fetching', async () => {
    const queryClient = createTestQueryClient();
    // Seed the cache exactly as a preceding SearchBox preview would.
    queryClient.setQueryData(['search', 'preview', { q: 'alpha', libraryId: null }], previewData);

    const { result } = renderHook(() => useSearchResults('alpha', 'songs', null), {
      wrapper: hookWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(previewData);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('fetches when no preview matches the query', async () => {
    mockApi.mockResolvedValue(previewData);
    const { result } = renderHook(() => useSearchResults('beta', 'albums', null), {
      wrapper: hookWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi).toHaveBeenCalledWith('/search?q=beta&type=albums');
  });

  it('fetches when the query changes away from the previewed one', async () => {
    mockApi.mockResolvedValue(previewData);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['search', 'preview', { q: 'alpha', libraryId: null }], previewData);

    const { result, rerender } = renderHook(
      ({ query }) => useSearchResults(query, 'songs', null),
      { wrapper: hookWrapper(queryClient), initialProps: { query: 'alpha' } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi).not.toHaveBeenCalled();

    rerender({ query: 'alphabet' });

    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/search?q=alphabet&type=songs'));
  });
});
