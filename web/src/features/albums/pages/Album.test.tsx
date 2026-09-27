import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
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

const user = { id: 'u1', username: 'tester', isAdmin: true, blurExplicitTitles: false, blurExplicitCovers: false } as User;

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

function renderAlbum(path: string, queryClient = createTestQueryClient()) {
  const location = memoryLocation({ path });
  return {
    location,
    ...renderWithQueryClient(
      <Router hook={location.hook}>
        <NotificationProvider>
          <Route path="/albums/:id">{() => <Album user={user} />}</Route>
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
