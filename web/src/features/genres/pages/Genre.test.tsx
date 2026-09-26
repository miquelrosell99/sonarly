import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Genre } from './Genre.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

function renderGenre(path: string) {
  const loc = memoryLocation({ path });
  return {
    loc,
    ...renderWithQueryClient(
      <Router hook={loc.hook}>
        <Route path="/genres/:genre" component={Genre} />
      </Router>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Genre', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs')) {
        return { songs: [{ id: 'song-1', title: 'Genre Track', year: 2020 }] };
      }
      if (path.startsWith('/albums')) {
        return { albums: [{ id: 'album-1', name: 'Genre Album', year: 2020 }] };
      }
      return {};
    });
  });

  it('fetches the filtered songs/albums lists by server filter (loading → success)', async () => {
    renderGenre('/genres/Rock');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });
    expect(screen.getByText('Genre Album')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/songs?genre=Rock');
    expect(mockApi).toHaveBeenCalledWith('/albums?genre=Rock');
  });

  it('refetches under a new query key when the genre param changes', async () => {
    const { loc } = renderGenre('/genres/Rock');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });
    expect(mockApi).toHaveBeenCalledTimes(2);

    loc.navigate('/genres/Jazz');

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/songs?genre=Jazz');
      expect(mockApi).toHaveBeenCalledWith('/albums?genre=Jazz');
    });
    expect(mockApi.mock.calls.filter((call) => call[0] === '/songs?genre=Jazz')).toHaveLength(1);
  });

  it('drops its cache when the library:changed prefixes are invalidated (SSE contract)', async () => {
    const { queryClient } = renderGenre('/genres/Rock');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });
    const callsAfterLoad = mockApi.mock.calls.length;

    await queryClient.invalidateQueries({ queryKey: ['songs'] });
    await queryClient.invalidateQueries({ queryKey: ['albums'] });

    await waitFor(() => {
      expect(mockApi.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    });
  });
});
