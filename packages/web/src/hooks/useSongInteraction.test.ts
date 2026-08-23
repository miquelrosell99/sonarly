import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useSongInteraction } from './useSongInteraction.js';

const mockApi = vi.hoisted(() => vi.fn());
const mockSetFavorite = vi.hoisted(() => vi.fn());
const mockSetRating = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  api: mockApi,
}));

vi.mock('./useFavoriteActions.js', () => ({
  useFavoriteActions: () => ({
    setFavorite: mockSetFavorite,
    setRating: mockSetRating,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const song = { id: 'song-1', title: 'Track One', starred: true, rating: 4 };

describe('useSongInteraction', () => {
  beforeEach(() => {
    mockApi.mockResolvedValue({ song });
  });

  it('fetches interaction state for the given song id', async () => {
    const { result } = renderHook(() => useSongInteraction('song-1'));

    expect(result.current.starred).toBeUndefined();
    expect(result.current.rating).toBeUndefined();

    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/songs/song-1'));
    expect(result.current.starred).toBe(true);
    expect(result.current.rating).toBe(4);
  });

  it('uses fallback values while loading', async () => {
    const { result } = renderHook(() => useSongInteraction('song-1', { starred: false, rating: 2 }));

    expect(result.current.starred).toBe(false);
    expect(result.current.rating).toBe(2);
  });

  it('falls back to initial values on fetch failure', async () => {
    mockApi.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useSongInteraction('song-1', { starred: true, rating: 5 }));

    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(result.current.starred).toBe(true);
    expect(result.current.rating).toBe(5);
  });

  it('updates favorite optimistically and calls the api', async () => {
    const { result } = renderHook(() => useSongInteraction('song-1', { starred: false, rating: 0 }));
    await waitFor(() => expect(result.current.starred).toBe(true));

    await result.current.setFavorite(false);

    await waitFor(() => expect(result.current.starred).toBe(false));
    expect(mockSetFavorite).toHaveBeenCalledWith('song', 'song-1', false);
  });

  it('reverts favorite on mutation failure', async () => {
    mockSetFavorite.mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => useSongInteraction('song-1', { starred: true, rating: 4 }));
    await waitFor(() => expect(result.current.starred).toBe(true));

    await expect(result.current.setFavorite(false)).rejects.toThrow('Failed');
    await waitFor(() => expect(result.current.starred).toBe(true));
  });

  it('updates rating optimistically and calls the api', async () => {
    const { result } = renderHook(() => useSongInteraction('song-1', { starred: false, rating: 0 }));
    await waitFor(() => expect(result.current.rating).toBe(4));

    await result.current.setRating(5);

    await waitFor(() => expect(result.current.rating).toBe(5));
    expect(mockSetRating).toHaveBeenCalledWith('song', 'song-1', 5);
  });

  it('reverts rating on mutation failure', async () => {
    mockSetRating.mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => useSongInteraction('song-1', { starred: true, rating: 4 }));
    await waitFor(() => expect(result.current.rating).toBe(4));

    await expect(result.current.setRating(2)).rejects.toThrow('Failed');
    await waitFor(() => expect(result.current.rating).toBe(4));
  });

  it('does nothing when songId is undefined', async () => {
    const { result } = renderHook(() => useSongInteraction(undefined, { starred: true, rating: 3 }));
    expect(result.current.starred).toBe(true);
    expect(result.current.rating).toBe(3);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('resets to fallback values when songId changes', async () => {
    mockApi.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ song }), 10)),
    );
    const { result, rerender } = renderHook(
      ({ id, fallback }: { id: string; fallback: { starred?: boolean; rating?: number } }) =>
        useSongInteraction(id, fallback),
      { initialProps: { id: 'song-1', fallback: { starred: false, rating: 2 } } },
    );

    await waitFor(() => expect(result.current.starred).toBe(true));

    rerender({ id: 'song-2', fallback: { starred: true, rating: 5 } });

    expect(result.current.starred).toBe(true);
    expect(result.current.rating).toBe(5);

    await waitFor(() => expect(result.current.rating).toBe(4));
    expect(result.current.starred).toBe(true);
  });
});
