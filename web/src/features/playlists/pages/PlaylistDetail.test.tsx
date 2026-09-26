import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlaylistDetail } from './PlaylistDetail.js';
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

let playlistOwnerId = 'user-1';

function renderPlaylistDetail({ ownerId = 'user-1' } = {}) {
  playlistOwnerId = ownerId;
  window.history.pushState({}, '', '/playlists/playlist-1');
  const user = {
    id: 'user-1',
    username: 'user',
    isAdmin: false,
    createdAt: new Date().toISOString(),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <NotificationProvider>
          <Route path="/playlists/:id" component={() => <PlaylistDetail user={user} />} />
        </NotificationProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

describe('PlaylistDetail', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/playlists/playlist-1' || path.startsWith('/playlists/playlist-1?')) {
        return {
          playlist: {
            id: 'playlist-1',
            name: 'Test Playlist',
            ownerId: playlistOwnerId,
            visibility: 'private',
            isSmart: false,
            entries: [
              { id: 'song-1', title: 'Track One', artist: 'Artist A', album: 'Album A', duration: 180 },
              { id: 'song-2', title: 'Track Two', artist: 'Artist B', album: 'Album B', duration: 240 },
            ],
            starred: false,
          },
        };
      }
      return {};
    });
  });

  it('renders a context menu for each song row', async () => {
    renderPlaylistDetail();

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    fireEvent.contextMenu(firstDataRow);

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /play$/i })).toBeTruthy();
  });

  it('hides account-only actions from anonymous guests', async () => {
    window.history.pushState({}, '', '/playlists/playlist-1?shareToken=token-123');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <NotificationProvider>
            <Route path="/playlists/:id" component={() => <PlaylistDetail user={null} />} />
          </NotificationProvider>
        </Router>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });

    expect(screen.getAllByRole('button', { name: 'Play (hold to shuffle)' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /favorite/i })).toBeNull();
  });

  it('lets the owner delete the playlist after confirmation and navigates away', async () => {
    const { queryClient } = renderPlaylistDetail();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // ConfirmModal asks first; no DELETE request until confirmed
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete playlist')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/playlists/playlist-1', { method: 'DELETE' });

    mockApi.mockResolvedValueOnce({ ok: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/playlists/playlist-1', { method: 'DELETE' }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['playlists'] }),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/playlists'));
    expect(mockNotify.notify).toHaveBeenCalledWith('Deleted playlist "Test Playlist"', 'success');
  });

  it('does not delete when the confirm dialog is cancelled', async () => {
    renderPlaylistDetail();

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockApi).not.toHaveBeenCalledWith('/playlists/playlist-1', { method: 'DELETE' });
  });

  it('hides the delete action from non-owners', async () => {
    renderPlaylistDetail({ ownerId: 'user-2' });

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });
});
