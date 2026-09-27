import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Song, User } from '../../../types';
import { Album } from './Album.js';
import { NowPlayingRoute } from '../../now-playing/pages/NowPlayingRoute.js';
import { renderWithQueryClient, createTestQueryClient } from '../../../lib/testing.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import { usePlayer, resetPlayer } from '../../../stores/playerStore.js';
import { resetNowPlaying } from '../../now-playing/stores/nowPlayingStore.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../../../contexts/NotificationContext.js', () => ({
  useNotification: () => mockNotify,
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const user = { id: 'u1', username: 'tester', isAdmin: true, blurExplicitTitles: false, blurExplicitCovers: false } as User;
const nonAdmin = { ...user, id: 'u2', isAdmin: false } as User;

const makeSong = (id: string): Song =>
  ({
    id,
    title: `Song ${id}`,
    artistId: 'ar-1',
    artistName: 'Artist One',
    albumId: 'al-1',
    albumName: 'The Album',
    trackNumber: 1,
    duration: 200,
    starred: false,
    explicit: false,
    mtime: 0,
    active: true,
    coverArtMissing: false,
    gapless: false,
  }) as Song;

const albumPayload = () => ({
  album: {
    id: 'al-1',
    name: 'The Album',
    artistId: 'ar-1',
    artistName: 'Artist One',
    year: 2021,
    totalSongCount: 2,
    shownSongCount: 2,
    explicit: false,
    starred: false,
  },
  songs: [makeSong('s1'), makeSong('s2')],
});

function renderAlbum(path: string, queryClient = createTestQueryClient(), viewer: User = user) {
  const location = memoryLocation({ path, record: true });
  return {
    location,
    ...renderWithQueryClient(
      <Router hook={location.hook}>
        <NotificationProvider>
          <Route path="/albums/:id">{() => <Album user={viewer} />}</Route>
        </NotificationProvider>
      </Router>,
      queryClient,
    ),
  };
}

const albumCalls = () => mockApi.mock.calls.filter((call) => String(call[0]).startsWith('/albums/'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetPlayer();
  resetNowPlaying();
});

describe('Album detail (react-query, P5)', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/albums/')) return albumPayload();
      return {};
    });
  });

  it('cold-loads the album and its embedded songs from one request', async () => {
    renderAlbum('/albums/al-1');

    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));
    expect(screen.getByText('Song s1')).toBeTruthy();
    expect(screen.getByText('Song s2')).toBeTruthy();
    expect(albumCalls()).toHaveLength(1);
  });

  it('serves a remount from the cache without refetching', async () => {
    const queryClient = createTestQueryClient();
    const first = renderAlbum('/albums/al-1', queryClient);
    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));
    first.unmount();

    renderAlbum('/albums/al-1', queryClient);
    await screen.findByText('Song s1');

    expect(albumCalls()).toHaveLength(1);
  });

  it('renders the error state with retry; retrying refetches and recovers', async () => {
    let fail = true;
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/albums/')) {
        if (fail) throw new Error('boom');
        return albumPayload();
      }
      return {};
    });

    renderAlbum('/albums/al-1');

    expect((await screen.findByRole('alert')).textContent).toContain('boom');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));
    expect(albumCalls()).toHaveLength(2);
  });

  it('patches a favorite in place and invalidates the albums lists', async () => {
    const queryClient = createTestQueryClient();
    const listKey = ['albums', 'list', { libraryId: null }] as const;
    queryClient.setQueryData(listKey, { albums: [albumPayload().album] });

    renderAlbum('/albums/al-1', queryClient);
    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole('button', { name: 'Add favorite' })[0]);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove favorite' }).length).toBeGreaterThan(0));
    await waitFor(() => {
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    });
    expect(mockApi.mock.calls.some((call) => String(call[0]) === '/favorites')).toBe(true);
  });

  it('shares one album request between the overlay cold-load and the album page (F25)', async () => {
    const location = memoryLocation({ path: '/now-playing/album/al-1/s2' });
    await act(async () => {
      renderWithQueryClient(
        <Router hook={location.hook}>
          <NotificationProvider>
            <Route path="/now-playing/:context/:contextId/:songId">{() => <NowPlayingRoute user={user} />}</Route>
            <Route path="/albums/:id">{() => <Album user={user} />}</Route>
          </NotificationProvider>
        </Router>,
      );
    });

    // Cold deep link: the overlay route resolves the album once.
    await waitFor(() => {
      expect(usePlayer.getState().currentSong?.id).toBe('s2');
    });
    expect(albumCalls()).toHaveLength(1);

    // Navigating to the album page itself serves the warm cache — zero
    // additional requests, no second spinner cycle.
    act(() => location.navigate('/albums/al-1'));
    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));
    expect(screen.getByText('Song s1')).toBeTruthy();
    expect(albumCalls()).toHaveLength(1);
  });
});

describe('Album detail header delete (admin)', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/albums/')) return albumPayload();
      return {};
    });
  });

  it('hides the header Delete action from non-admins', async () => {
    renderAlbum('/albums/al-1', createTestQueryClient(), nonAdmin);

    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('lets an admin delete the album after confirmation: DELETE, invalidation, toast, navigation', async () => {
    const queryClient = createTestQueryClient();
    const listKey = ['albums', 'list', { libraryId: null }] as const;
    queryClient.setQueryData(listKey, { albums: [albumPayload().album] });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { location } = renderAlbum('/albums/al-1', queryClient);

    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // ConfirmModal asks first; no DELETE request until confirmed
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete album')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/albums/al-1', { method: 'DELETE' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/albums/al-1', { method: 'DELETE' }));
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['albums'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['search'] });
    });
    expect(mockNotify.notify).toHaveBeenCalledWith('Deleted album "The Album"', 'success');
    await waitFor(() => expect(location.history[location.history.length - 1]).toBe('/albums'));
  });

  it('does not delete when the header confirm dialog is cancelled', async () => {
    renderAlbum('/albums/al-1');

    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockApi).not.toHaveBeenCalledWith('/albums/al-1', { method: 'DELETE' });
  });

  it('offers Delete in the header context menu for admins and confirms before deleting', async () => {
    renderAlbum('/albums/al-1');

    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));

    // Right-click on the title header opens the album menu
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'The Album' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete album')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/albums/al-1', { method: 'DELETE' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/albums/al-1', { method: 'DELETE' }));
  });

  it('omits Delete from the header context menu for non-admins', async () => {
    renderAlbum('/albums/al-1', createTestQueryClient(), nonAdmin);

    await waitFor(() => expect(screen.getAllByText('The Album').length).toBeGreaterThan(0));

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'The Album' }));

    expect(screen.getByRole('menuitem', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });
});
