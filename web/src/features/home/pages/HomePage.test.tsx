import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import type { User } from '../../../types';
import { HomePage } from './HomePage.js';
import { renderWithQueryClient, createTestQueryClient } from '../../../lib/testing.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());
const playActions = vi.hoisted(() => ({
  playSong: vi.fn(),
  playSongs: vi.fn(),
  shufflePlay: vi.fn(),
  playNext: vi.fn(),
  addToQueue: vi.fn(),
}));
const favoriteActions = vi.hoisted(() => ({
  setFavorite: vi.fn(),
  setRating: vi.fn(),
}));

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

vi.mock('../../../hooks/usePlayActions.js', () => ({
  usePlayActions: () => playActions,
}));

vi.mock('../../../hooks/useFavoriteActions.js', () => ({
  useFavoriteActions: () => favoriteActions,
}));

const user = { id: 'user-1', username: 'listener', isAdmin: false } as User;

const homePayload = {
  genres: [{ name: 'Rock', songCount: 12 }],
  mostPlayed: [
    { id: 'album-1', name: 'Most Played Album', artistName: 'Artist A', starred: false },
  ],
  random: [{ id: 'album-2', name: 'Random Album', artistName: 'Artist B', starred: false }],
  recentAdditions: [
    { id: 'album-4', name: 'Newest Album', artistName: 'Artist D', starred: false },
    { id: 'album-5', name: 'Older Album', artistName: 'Artist E', starred: true },
  ],
  recentlyPlayed: [
    {
      id: 'song-1',
      title: 'Newest Played Song',
      artistId: 'artist-1',
      artistName: 'Artist A',
      albumId: 'album-1',
      albumName: 'Most Played Album',
      duration: 200,
      explicit: false,
      starred: false,
    },
    {
      id: 'song-2',
      title: 'Older Played Song',
      artistName: 'Artist B',
      explicit: false,
      starred: true,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HomePage', () => {
  beforeEach(() => {
    // jsdom does not implement matchMedia; FeaturedAlbum only reads a
    // prefers-reduced-motion flag out of it.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/home') return homePayload;
      return {};
    });
  });

  it('renders album sections and recently-played song cards', async () => {
    renderWithQueryClient(
      <Router>
        <NotificationProvider>
          <HomePage user={user} />
        </NotificationProvider>
      </Router>,
    );

    await waitFor(() => {
      // Appears in both the featured carousel and the Most played row.
      expect(screen.getAllByText('Most Played Album').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Random Album').length).toBeGreaterThan(0);
    // recentAdditions renders album cards: name + artist name. Newest Album
    // doubles as the recent-additions featured slide, hence getAllByText.
    expect(screen.getAllByText('Newest Album').length).toBeGreaterThan(0);
    expect(screen.getByText('Older Album')).toBeTruthy();
    // recentlyPlayed renders song cards: title + artist name.
    expect(screen.getByText('Newest Played Song')).toBeTruthy();
    expect(screen.getByText('Older Played Song')).toBeTruthy();
    expect(screen.queryByText('No recently added albums.')).toBeFalsy();
    expect(mockApi).toHaveBeenCalledWith('/home');
  });

  it('plays the recently-played song list in order from the clicked card', async () => {
    renderWithQueryClient(
      <Router>
        <NotificationProvider>
          <HomePage user={user} />
        </NotificationProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Older Played Song')).toBeTruthy();
    });
    // Pointer-origin activation: fire the pointer gesture, not a bare click —
    // a detail-0 (keyboard-origin) click now performs the announced shuffle
    // affordance (audit F27f).
    const cardPlay = screen.getByRole('button', { name: 'Older Played Song (hold to shuffle)' });
    fireEvent.pointerDown(cardPlay);
    fireEvent.pointerUp(cardPlay);

    const songs = homePayload.recentlyPlayed;
    expect(playActions.playSongs).toHaveBeenCalledWith(songs, 1);
  });

  it('shows an empty message when there are no recent additions', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/home') return { ...homePayload, recentAdditions: [] };
      return {};
    });
    renderWithQueryClient(
      <Router>
        <NotificationProvider>
          <HomePage user={user} />
        </NotificationProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('No recently added albums.')).toBeTruthy();
    });
  });

  it('routes recent-song favorites through the shared invalidation map (adds search)', async () => {
    const queryClient = createTestQueryClient();
    const searchKey = ['search', 'results', { q: 'recent', type: 'songs', libraryId: null }] as const;
    queryClient.setQueryData(searchKey, { songs: [], albums: [], artists: [], playlists: [] });

    renderWithQueryClient(
      <Router>
        <NotificationProvider>
          <HomePage user={user} />
        </NotificationProvider>
      </Router>,
      queryClient,
    );

    await waitFor(() => {
      expect(screen.getByText('Newest Played Song')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Newest Played Song' }));

    await waitFor(() => {
      expect(queryClient.getQueryState(searchKey)?.isInvalidated).toBe(true);
    });
    expect(favoriteActions.setFavorite).toHaveBeenCalledWith('song', 'song-1', true);
  });
});
