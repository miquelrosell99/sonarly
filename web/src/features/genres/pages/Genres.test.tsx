import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { Genres } from './Genres.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Genres', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/genres') {
        return {
          genres: [
            { id: 'genre-2', name: 'Rock', path: 'Rock' },
            { id: 'genre-1', name: 'Jazz', path: 'Jazz' },
          ],
        };
      }
      if (path === '/songs') {
        return { songs: [] };
      }
      return {};
    });
  });

  it('loads genres sorted by name plus their track map (loading → success)', async () => {
    renderWithQueryClient(
      <Router>
        <NotificationProvider>
          <Genres />
        </NotificationProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Jazz')).toBeTruthy();
    });
    expect(screen.getByText('Rock')).toBeTruthy();
    // Jazz sorts before Rock; assert order via DOM position.
    const jazz = screen.getByText('Jazz');
    const rock = screen.getByText('Rock');
    expect(jazz.compareDocumentPosition(rock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
