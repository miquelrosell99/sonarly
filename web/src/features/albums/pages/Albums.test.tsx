import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Albums } from './Albums.js';
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

function renderAlbums() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <Router>
        <QueryClientProvider client={queryClient}>
          <NotificationProvider>
            <Albums user={{ id: 'user-1', username: 'admin', isAdmin: true, createdAt: new Date().toISOString() }} />
          </NotificationProvider>
        </QueryClientProvider>
      </Router>,
    ),
  };
}

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

  it('loads albums from the react-query cache (loading → success)', async () => {
    renderAlbums();

    await waitFor(() => {
      expect(screen.getByText('Album One')).toBeTruthy();
    });
    expect(mockApi).toHaveBeenCalledWith('/albums');
  });

  it('passes renderContextMenu to LibraryView and the menu renders', async () => {
    renderAlbums();

    await waitFor(() => {
      expect(screen.getByText('Album One')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /list view/i }));

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    fireEvent.contextMenu(firstDataRow);

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^play$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /edit/i })).toBeTruthy();
  });

  it('drops its cache when the library:changed prefixes are invalidated (SSE contract)', async () => {
    const { queryClient } = renderAlbums();

    await waitFor(() => {
      expect(screen.getByText('Album One')).toBeTruthy();
    });
    expect(mockApi).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({ queryKey: ['albums'] });

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledTimes(2);
    });
  });

  it('header shuffle play samples at most 100 albums randomly and queues their songs', async () => {
    const manyAlbums = Array.from({ length: 150 }, (_, i) => ({
      id: `album-${i + 1}`,
      name: `Album ${i + 1}`,
      artistName: 'Artist',
      year: 2020,
      starred: false,
    }));
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/albums') {
        return { albums: manyAlbums };
      }
      if (path.startsWith('/albums/')) {
        const id = path.split('/')[2];
        return { album: { id }, songs: [{ id: `song-${id}` }] };
      }
      return {};
    });

    renderAlbums();
    await waitFor(() => {
      expect(screen.getByText('Album 1')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Shuffle play' }));

    await waitFor(() => {
      expect(playActions.shufflePlay).toHaveBeenCalledTimes(1);
    });
    const detailCalls = mockApi.mock.calls.filter((call) => /^\/albums\/album-/.test(call[0] as string));
    expect(detailCalls).toHaveLength(100);
    expect(new Set(detailCalls.map((call) => call[0])).size).toBe(100);

    const queued = playActions.shufflePlay.mock.calls[0][0] as { id: string }[];
    expect(queued).toHaveLength(100);
    expect(queued.every((song) => song.id.startsWith('song-album-'))).toBe(true);
  });
});
