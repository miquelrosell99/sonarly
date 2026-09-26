import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
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
      return {};
    });
  });

  it('loads years and tracks (loading → success)', async () => {
    renderWithQueryClient(
      <Router>
        <Years />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('2020 — 1 song')).toBeTruthy();
    });
    expect(screen.getByText('2021 — 5 songs')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/years');
    expect(mockApi).toHaveBeenCalledWith('/songs');
  });
});
