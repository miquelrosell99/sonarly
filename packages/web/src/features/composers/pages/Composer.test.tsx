import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Composer } from './Composer.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Composer', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs')) {
        return { songs: [{ id: 'song-1', title: 'Composed Track', duration: 30 }] };
      }
      return {};
    });
  });

  it('fetches the composer-filtered song list (loading → success)', async () => {
    const loc = memoryLocation({ path: '/composers/John%20Doe' });
    renderWithQueryClient(
      <Router hook={loc.hook}>
        <Route path="/composers/:name" component={Composer} />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Composed Track')).toBeTruthy();
    });
    expect(mockApi).toHaveBeenCalledWith('/songs?composer=John+Doe');
  });
});
