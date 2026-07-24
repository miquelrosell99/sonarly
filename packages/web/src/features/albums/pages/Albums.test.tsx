import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { Albums } from './Albums.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const playActions = vi.hoisted(() => ({
  playSong: vi.fn(),
  playSongs: vi.fn(),
  shufflePlay: vi.fn(),
  playNext: vi.fn(),
  addToQueue: vi.fn(),
}));

vi.mock('../../../hooks/usePlayActions.js', () => ({
  usePlayActions: () => playActions,
}));

const favoriteActions = vi.hoisted(() => ({
  setFavorite: vi.fn(),
  setRating: vi.fn(),
}));

vi.mock('../../../hooks/useFavoriteActions.js', () => ({
  useFavoriteActions: () => favoriteActions,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Albums', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/albums') {
        return {
          albums: [
            { id: 'album-1', name: 'Album One', artistName: 'Artist A', year: 2020, starred: false },
            { id: 'album-2', name: 'Album Two', artistName: 'Artist B', year: 2021, starred: true },
          ],
        };
      }
      return {};
    });
  });

  it('passes renderContextMenu to LibraryView and the menu renders', async () => {
    render(
      <Router>
        <NotificationProvider>
          <Albums />
        </NotificationProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Album One')).toBeTruthy();
    });

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    fireEvent.contextMenu(firstDataRow);

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /play$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /edit/i })).toBeTruthy();
  });
});
