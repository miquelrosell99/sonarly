import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TopBar } from './TopBar.js';
import { useSongsList } from '../hooks/useLibraryLists.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../contexts/NotificationContext.js', () => ({
  useNotification: () => mockNotify,
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const user = {
  id: 'u1',
  username: 'user',
  isAdmin: false,
  createdAt: new Date().toISOString(),
} as const;

// Stands in for the Tracks page: a same-family consumer mounted alongside the
// TopBar, exactly like the real /tracks route composition.
function SongsPageConsumer() {
  const { data } = useSongsList({ libraryId: null });
  return <div data-testid="songs-count">{data?.songs.length ?? 0}</div>;
}

function renderAt(path: string, ui: React.ReactNode) {
  window.history.pushState({}, '', path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <Router>{ui}</Router>
      </QueryClientProvider>,
    ),
  };
}

const callsFor = (path: string) => mockApi.mock.calls.filter(([p]) => p === path);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TopBar filter data (F12 shared key families)', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      switch (path) {
        case '/songs':
          return { songs: [{ id: 'song-1', title: 'One' }, { id: 'song-2', title: 'Two' }] };
        case '/albums':
          return { albums: [{ id: 'album-1', name: 'Album', genre: 'Rock' }] };
        case '/playlists':
          return { playlists: [] };
        case '/libraries':
          return { libraries: [] };
        case '/players':
          return { players: [] };
        default:
          return {};
      }
    });
  });

  it('fetches /songs once when the list page and the TopBar filters mount together', async () => {
    const { queryClient, getByTestId } = renderAt(
      '/tracks',
      <>
        <SongsPageConsumer />
        <TopBar user={user} onLogout={() => {}} />
      </>,
    );

    // Both consumers resolve from the single shared cache entry…
    await waitFor(() => {
      expect(getByTestId('songs-count').textContent).toBe('2');
    });
    expect(callsFor('/songs')).toHaveLength(1);

    // …which is the documented ['songs', 'list', params] family, not the
    // retired TopBar-only ['songs', libraryId] duplicate.
    const songsKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
      .filter((key) => key[0] === 'songs');
    expect(songsKeys).toEqual([['songs', 'list', { libraryId: null }]]);
  });

  it('does not fetch albums/songs/playlists filter data on routes without filters', async () => {
    renderAt('/home', <TopBar user={user} onLogout={() => {}} />);

    await waitFor(() => {
      expect(callsFor('/libraries')).toHaveLength(1);
    });
    expect(callsFor('/songs')).toHaveLength(0);
    expect(callsFor('/albums')).toHaveLength(0);
    expect(callsFor('/playlists')).toHaveLength(0);
  });

  it('refetches /libraries when the SSE library-changed event fires', async () => {
    renderAt('/home', <TopBar user={user} onLogout={() => {}} />);

    await waitFor(() => {
      expect(callsFor('/libraries')).toHaveLength(1);
    });

    window.dispatchEvent(new Event('sonarly:library-changed'));

    await waitFor(() => {
      expect(callsFor('/libraries')).toHaveLength(2);
    });
  });
});
