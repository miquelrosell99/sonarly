import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { Router } from 'wouter';
import { Years } from './Years.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('Years', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/years') {
        return { years: [{ year: 2021, songCount: 5 }, { year: 2020, songCount: 1 }] };
      }
      if (path === '/songs') {
        return {
          songs: [
            { id: 'song-1', title: 'Old Song', year: 2020 },
            { id: 'song-2', title: 'New Song', year: 2021 },
          ],
        };
      }
      if (path.startsWith('/albums?')) {
        return { albums: [] };
      }
      return {};
    });
  });

  it('loads years and tracks (loading → success), list shows the year only', async () => {
    renderWithQueryClient(
      <Router>
        <Years />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('2020')).toBeTruthy();
    });
    expect(screen.getByText('2021')).toBeTruthy();
    expect(screen.queryByText(/— \d+ song/)).toBeNull();
    expect(mockApi).toHaveBeenCalledWith('/years');
    expect(mockApi).toHaveBeenCalledWith('/songs');
  });

  it('switches to grid view and loads album covers per year', async () => {
    renderWithQueryClient(
      <Router>
        <Years />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('2021')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/albums?year=2021&limit=4');
      expect(mockApi).toHaveBeenCalledWith('/albums?year=2020&limit=4');
    });
    // Grid cards carry the count as a subtitle.
    expect(screen.getByText('5 songs')).toBeTruthy();
    expect(screen.getByText('1 song')).toBeTruthy();
  });
});
