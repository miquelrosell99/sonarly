import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlaylistDetail } from './PlaylistDetail.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPlaylistDetail() {
  window.history.pushState({}, '', '/playlists/playlist-1');
  const user = {
    id: 'user-1',
    username: 'user',
    isAdmin: false,
    createdAt: new Date().toISOString(),
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <NotificationProvider>
          <Route path="/playlists/:id" component={() => <PlaylistDetail user={user} />} />
        </NotificationProvider>
      </Router>
    </QueryClientProvider>,
  );
}

describe('PlaylistDetail', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/playlists/playlist-1') {
        return {
          playlist: {
            id: 'playlist-1',
            name: 'Test Playlist',
            ownerId: 'user-1',
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
});
