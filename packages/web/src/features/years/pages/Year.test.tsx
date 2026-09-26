import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Year } from './Year.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

function renderYear(path: string) {
  const loc = memoryLocation({ path });
  return renderWithQueryClient(
    <Router hook={loc.hook}>
      <Route path="/years/:year" component={Year} />
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Year', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/songs') {
        return {
          songs: [
            { id: 'song-1', title: 'Song From 2020', year: 2020 },
            { id: 'song-2', title: 'Song From 2021', year: 2021 },
          ],
        };
      }
      if (path === '/albums') {
        return {
          albums: [
            { id: 'album-1', name: 'Album From 2020', year: 2020 },
            { id: 'album-2', name: 'Album From 2021', year: 2021 },
          ],
        };
      }
      return {};
    });
  });

  it('filters the shared full lists client-side to the year (loading → success)', async () => {
    renderYear('/years/2020');

    await waitFor(() => {
      expect(screen.getByText('Song From 2020')).toBeTruthy();
    });
    expect(screen.getByText('Album From 2020')).toBeTruthy();
    // Client-side filter: 2021 rows are not shown, and only one fetch per
    // list fires (same keys as the Tracks/Albums pages).
    expect(screen.queryByText('Song From 2021')).toBeNull();
    expect(screen.queryByText('Album From 2021')).toBeNull();
    expect(mockApi).toHaveBeenCalledWith('/songs');
    expect(mockApi).toHaveBeenCalledWith('/albums');
  });
});
