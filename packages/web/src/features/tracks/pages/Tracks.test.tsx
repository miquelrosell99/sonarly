import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import type { User } from '@sonarly/shared';
import { Tracks } from './Tracks.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const user = { id: 'user-1', username: 'listener', isAdmin: false } as User;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Tracks', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/songs') {
        return {
          songs: [
            { id: 'song-1', title: 'Track One', artistName: 'Artist A', albumName: 'Album A', duration: 60 },
            { id: 'song-2', title: 'Track Two', artistName: 'Artist B', albumName: 'Album B', duration: 90 },
          ],
        };
      }
      return {};
    });
  });

  it('loads tracks through the songs query family (loading → success)', async () => {
    renderWithQueryClient(
      <Router>
        <Tracks user={user} />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });
    expect(screen.getByText('Track Two')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/songs');
  });

  it('drops its cache when the library:changed prefixes are invalidated (SSE contract)', async () => {
    const { queryClient } = renderWithQueryClient(
      <Router>
        <Tracks user={user} />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });
    expect(mockApi).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({ queryKey: ['songs'] });

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledTimes(2);
    });
  });
});
