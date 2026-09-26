import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useFavoriteActions } from './useFavoriteActions.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useFavoriteActions', () => {
  beforeEach(() => {
    mockApi.mockResolvedValue({ ok: true });
  });

  it('maps each entity type to its per-type id key on /favorites', async () => {
    const { result } = renderHook(() => useFavoriteActions());

    await result.current.setFavorite('song', 'song-1', true);
    await result.current.setFavorite('album', 'album-1', false);
    await result.current.setFavorite('artist', 'artist-1', true);
    await result.current.setFavorite('playlist', 'playlist-1', true);

    expect(mockApi).toHaveBeenNthCalledWith(1, '/favorites', {
      method: 'POST',
      body: JSON.stringify({ songId: 'song-1', starred: true }),
    });
    expect(mockApi).toHaveBeenNthCalledWith(2, '/favorites', {
      method: 'POST',
      body: JSON.stringify({ albumId: 'album-1', starred: false }),
    });
    expect(mockApi).toHaveBeenNthCalledWith(3, '/favorites', {
      method: 'POST',
      body: JSON.stringify({ artistId: 'artist-1', starred: true }),
    });
    expect(mockApi).toHaveBeenNthCalledWith(4, '/favorites', {
      method: 'POST',
      body: JSON.stringify({ playlistId: 'playlist-1', starred: true }),
    });
  });

  it('maps each entity type to its per-type id key on /ratings', async () => {
    const { result } = renderHook(() => useFavoriteActions());

    await result.current.setRating('song', 'song-1', 4);
    await result.current.setRating('album', 'album-1', undefined);

    expect(mockApi).toHaveBeenNthCalledWith(1, '/ratings', {
      method: 'POST',
      body: JSON.stringify({ songId: 'song-1', rating: 4 }),
    });
    expect(mockApi).toHaveBeenNthCalledWith(2, '/ratings', {
      method: 'POST',
      body: JSON.stringify({ albumId: 'album-1', rating: undefined }),
    });
  });
});
