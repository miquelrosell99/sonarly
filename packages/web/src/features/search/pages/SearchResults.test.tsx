import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import type { User } from '@sonarly/shared';
import { SearchResults } from './SearchResults.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import * as apiModule from '../../../api.js';

const mockUser = { id: 'u1', username: 'test', isAdmin: false } as User;

const mockLocation = (search: string) => {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { search },
  });
};

function renderWithRouter(search: string, user = mockUser) {
  mockLocation(search);
  return render(
    <Router>
      <NotificationProvider>
        <SearchResults user={user} />
      </NotificationProvider>
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SearchResults', () => {
  it('renders empty state when query is empty', () => {
    renderWithRouter('');
    expect(screen.getByText('No songs match "".')).toBeTruthy();
  });

  it('fetches and renders songs for the selected type', async () => {
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      songs: [
        {
          id: 'song-1',
          title: 'Alpha Song',
          artistName: 'Alpha Artist',
          albumName: 'Alpha Album',
          filePath: '/data/library/song1.mp3',
          mtime: 0,
          checksum: '',
        },
      ],
      albums: [],
      artists: [],
      playlists: [],
    });

    renderWithRouter('?q=alpha&type=songs');

    await waitFor(() => {
      expect(screen.getByText('Songs matching "alpha"')).toBeTruthy();
    });
    expect(screen.getByText('Alpha Song')).toBeTruthy();
    expect(screen.getByText('Alpha Artist')).toBeTruthy();
    expect(screen.getByText('Alpha Album')).toBeTruthy();
  });

  it('renders an explicit badge for explicit songs', async () => {
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      songs: [
        {
          id: 'song-1',
          title: 'Explicit Song',
          artistName: 'Alpha Artist',
          albumName: 'Alpha Album',
          explicit: true,
          filePath: '/data/library/song1.mp3',
          mtime: 0,
          checksum: '',
        },
      ],
      albums: [],
      artists: [],
      playlists: [],
    });

    renderWithRouter('?q=alpha&type=songs');

    await waitFor(() => {
      expect(screen.getByText('Explicit Song')).toBeTruthy();
    });
    expect(screen.getByLabelText('Explicit')).toBeTruthy();
  });

  it('blurs explicit song titles when the user prefers blurred explicit titles', async () => {
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      songs: [
        {
          id: 'song-1',
          title: 'Explicit Song',
          artistName: 'Alpha Artist',
          explicit: true,
          filePath: '/data/library/song1.mp3',
          mtime: 0,
          checksum: '',
        },
      ],
      albums: [],
      artists: [],
      playlists: [],
    });

    renderWithRouter('?q=alpha&type=songs', { ...mockUser, blurExplicitTitles: true });

    await waitFor(() => {
      expect(screen.getByText('Explicit Song')).toBeTruthy();
    });
    expect(screen.getByText('Explicit Song').parentElement?.className.includes('blur-sm')).toBe(true);
  });

  it('fetches and renders albums for the selected type', async () => {
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      songs: [],
      albums: [
        {
          id: 'album-1',
          name: 'Alpha Album',
          artistName: 'Alpha Artist',
          year: 2024,
        },
      ],
      artists: [],
      playlists: [],
    });

    renderWithRouter('?q=alpha&type=albums');

    await waitFor(() => {
      expect(screen.getByText('Albums matching "alpha"')).toBeTruthy();
    });
    expect(screen.getByText('Alpha Album')).toBeTruthy();
    expect(screen.getByText('Alpha Artist • 2024')).toBeTruthy();
  });

  it('fetches and renders artists for the selected type', async () => {
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      songs: [],
      albums: [],
      artists: [{ id: 'artist-1', name: 'Alpha Artist' }],
      playlists: [],
    });

    renderWithRouter('?q=alpha&type=artists');

    await waitFor(() => {
      expect(screen.getByText('Artists matching "alpha"')).toBeTruthy();
    });
    expect(screen.getByText('Alpha Artist')).toBeTruthy();
  });

  it('fetches and renders playlists for the selected type', async () => {
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      songs: [],
      albums: [],
      artists: [],
      playlists: [
        {
          id: 'playlist-1',
          name: 'Alpha Playlist',
          ownerUsername: 'owner',
          visibility: 'public',
          ownerId: 'owner-1',
          songIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    renderWithRouter('?q=alpha&type=playlists');

    await waitFor(() => {
      expect(screen.getByText('Playlists matching "alpha"')).toBeTruthy();
    });
    expect(screen.getByText('Alpha Playlist')).toBeTruthy();
    expect(screen.getByText('owner')).toBeTruthy();
  });

  it('defaults to songs when type is invalid', async () => {
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      songs: [{ id: 'song-1', title: 'Alpha Song', filePath: '', mtime: 0, checksum: '' }],
      albums: [],
      artists: [],
      playlists: [],
    });

    renderWithRouter('?q=alpha&type=invalid');

    await waitFor(() => {
      expect(screen.getByText('Songs matching "alpha"')).toBeTruthy();
    });
  });
});
