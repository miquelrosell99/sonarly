import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { Artists } from './Artists.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

function renderArtists() {
  return renderWithQueryClient(
    <Router>
      <NotificationProvider>
        <Artists />
      </NotificationProvider>
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Artists', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/artists') {
        return {
          artists: [
            { id: 'artist-1', name: 'Artist One' },
            { id: 'artist-2', name: 'Artist Two' },
          ],
        };
      }
      if (path === '/songs') {
        return { songs: [] };
      }
      return {};
    });
  });

  it('loads artists and their genre map (loading → success)', async () => {
    renderArtists();

    await waitFor(() => {
      expect(screen.getByText('Artist One')).toBeTruthy();
    });
    expect(screen.getByText('Artist Two')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/artists');
    expect(mockApi).toHaveBeenCalledWith('/songs');
  });

  it('drops its cache when the library:changed prefixes are invalidated (SSE contract)', async () => {
    const { queryClient } = renderArtists();

    await waitFor(() => {
      expect(screen.getByText('Artist One')).toBeTruthy();
    });
    const callsAfterLoad = mockApi.mock.calls.length;

    await queryClient.invalidateQueries({ queryKey: ['artists'] });

    await waitFor(() => {
      expect(mockApi.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    });
  });
});
