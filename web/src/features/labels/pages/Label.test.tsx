import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Label } from './Label.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

function renderLabel(path: string) {
  const loc = memoryLocation({ path });
  return {
    loc,
    ...renderWithQueryClient(
      <Router hook={loc.hook}>
        <Route path="/labels/:name" component={Label} />
      </Router>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Label', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs')) {
        return { songs: [{ id: 'song-1', title: 'Label Track' }] };
      }
      if (path.startsWith('/albums')) {
        return { albums: [{ id: 'album-1', name: 'Label Album' }] };
      }
      return {};
    });
  });

  it('fetches the label-filtered song and album lists (loading → success)', async () => {
    renderLabel('/labels/Sub%20Pop');

    await waitFor(() => {
      expect(screen.getByText('Label Track')).toBeTruthy();
    });
    expect(screen.getByText('Label Album')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/songs?label=Sub+Pop');
    expect(mockApi).toHaveBeenCalledWith('/albums?label=Sub+Pop');
  });

  it('refetches under a new query key when the label param changes', async () => {
    const { loc } = renderLabel('/labels/Sub%20Pop');

    await waitFor(() => {
      expect(screen.getByText('Label Track')).toBeTruthy();
    });
    expect(mockApi).toHaveBeenCalledTimes(2);

    loc.navigate('/labels/Warp');

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/songs?label=Warp');
      expect(mockApi).toHaveBeenCalledWith('/albums?label=Warp');
    });
  });
});
