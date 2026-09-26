import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import type { User } from '../../../types';
import { HomePage } from './HomePage.js';
import { renderWithQueryClient } from '../../../lib/testing.js';
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
    {
      id: 'song-1',
      title: 'Newest Song',
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
      title: 'Older Song',
      artistName: 'Artist B',
      explicit: false,
      starred: true,
    },
  ],
  recentlyPlayed: [
    { id: 'album-3', name: 'Recently Played Album', artistName: 'Artist C', starred: false },
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

  it('renders album sections and recent-additions song cards', async () => {
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
    expect(screen.getAllByText('Recently Played Album').length).toBeGreaterThan(0);
    // recentAdditions renders song cards: title + artist name.
    expect(screen.getByText('Newest Song')).toBeTruthy();
    expect(screen.getByText('Older Song')).toBeTruthy();
    expect(screen.queryByText('No recently added songs.')).toBeFalsy();
    expect(mockApi).toHaveBeenCalledWith('/home');
  });

  it('plays the recent-additions song list in order from the clicked card', async () => {
    renderWithQueryClient(
      <Router>
        <NotificationProvider>
          <HomePage user={user} />
        </NotificationProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Older Song')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Older Song (hold to shuffle)' }));

    const songs = homePayload.recentAdditions;
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
      expect(screen.getByText('No recently added songs.')).toBeTruthy();
    });
  });
});
