import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Playlists } from './Playlists.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../../../contexts/NotificationContext.js', () => ({
  useNotification: () => mockNotify,
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const favoriteActions = vi.hoisted(() => ({
  setFavorite: vi.fn(),
  setRating: vi.fn(),
}));

vi.mock('../../../hooks/useFavoriteActions.js', () => ({
  useFavoriteActions: () => favoriteActions,
}));

vi.mock('../components/PlaylistCoverGrid.js', () => ({
  PlaylistCoverGrid: () => <div data-testid="cover-grid" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPlaylists() {
  window.history.pushState({}, '', '/playlists');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <NotificationProvider>
            <Playlists />
          </NotificationProvider>
        </Router>
      </QueryClientProvider>,
    ),
  };
}

const playlistRow = {
  id: 'playlist-1',
  name: 'Road Trip',
  ownerId: 'user-1',
  ownerUsername: 'user',
  visibility: 'public',
  songCount: 3,
  starred: false,
};

describe('Playlists page favorite wiring', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/playlists') return { playlists: [playlistRow] };
      return {};
    });
    favoriteActions.setFavorite.mockResolvedValue(undefined);
    favoriteActions.setRating.mockResolvedValue(undefined);
  });

  it('invalidates the playlists cache when a favorite toggle succeeds', async () => {
    const { queryClient } = renderPlaylists();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() => {
      expect(screen.getByText('Road Trip')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add favorite' }));

    await waitFor(() =>
      expect(favoriteActions.setFavorite).toHaveBeenCalledWith('playlist', 'playlist-1', true),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['playlists'] }),
    );
  });

  it('notifies when the favorite toggle fails', async () => {
    favoriteActions.setFavorite.mockRejectedValueOnce(new Error('Server exploded'));
    renderPlaylists();

    await waitFor(() => {
      expect(screen.getByText('Road Trip')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add favorite' }));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Server exploded', 'error'),
    );
  });

  it('notifies when the rating fails', async () => {
    favoriteActions.setRating.mockRejectedValueOnce(new Error('Rating failed'));
    renderPlaylists();

    await waitFor(() => {
      expect(screen.getByText('Road Trip')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rate 4 stars' }));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Rating failed', 'error'),
    );
  });
});
