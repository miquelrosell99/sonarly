import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { AlbumArtists } from './AlbumArtists.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AlbumArtists', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/albums') {
        return {
          albums: [
            { id: 'album-1', name: 'Album One', artistId: 'artist-1', artistName: 'Artist A' },
            { id: 'album-2', name: 'Album Two', artistId: 'artist-2', artistName: 'Artist B' },
            { id: 'album-3', name: 'Album Three', artistId: 'artist-1', artistName: 'Artist A' },
          ],
        };
      }
      return {};
    });
  });

  it('derives album artists from the albums list (loading → success)', async () => {
    renderWithQueryClient(
      <Router>
        <AlbumArtists />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Artist A')).toBeTruthy();
    });
    expect(screen.getByText('Artist B')).toBeTruthy();
    // Derived: one entry per distinct artistId, sorted by name.
    expect(screen.getAllByText('Artist A')).toHaveLength(1);
    expect(mockApi).toHaveBeenCalledWith('/albums');
  });
});
