import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { Composers } from './Composers.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Composers', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/songs') {
        return {
          songs: [
            {
              id: 'song-1',
              title: 'Song One',
              composerEntries: [{ id: 'composer-b', name: 'Composer B' }],
            },
            {
              id: 'song-2',
              title: 'Song Two',
              composerEntries: [{ id: 'composer-a', name: 'Composer A' }],
            },
          ],
        };
      }
      return {};
    });
  });

  it('derives the sorted composer list from songs (loading → success)', async () => {
    renderWithQueryClient(
      <Router>
        <Composers />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Composer A')).toBeTruthy();
    });
    expect(screen.getByText('Composer B')).toBeTruthy();
    const a = screen.getByText('Composer A');
    const b = screen.getByText('Composer B');
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('drops its cache when the library:changed prefixes are invalidated (SSE contract)', async () => {
    const { queryClient } = renderWithQueryClient(
      <Router>
        <Composers />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Composer A')).toBeTruthy();
    });
    expect(mockApi).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({ queryKey: ['songs'] });

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledTimes(2);
    });
  });
});
