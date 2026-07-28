import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { User } from '@sonarly/shared';
import { PlayerBar } from './PlayerBar.js';
import { usePlayer, resetPlayer } from '../stores/playerStore.js';
import { useNowPlaying, resetNowPlaying } from '../features/now-playing/index.js';
import { NotificationProvider } from '../contexts/NotificationContext.js';

const mockSetFavorite = vi.hoisted(() => vi.fn());
const mockSetRating = vi.hoisted(() => vi.fn());

const mockUpdateCurrentSong = vi.hoisted(() => vi.fn());

const mockUpdatePreferencesMutate = vi.hoisted(() => vi.fn());

const mockPreferences = vi.hoisted(() => ({
  autoDjEnabled: false,
  autoDjMode: 'smart' as const,
  autoDjTopUpThreshold: 5,
  autoDjBatchSize: 10,
}));

const mockUser = { id: 'u1', username: 'test', isAdmin: false } as User;

vi.mock('../hooks/useSongInteraction.js', () => ({
  useSongInteraction: (songId: string | undefined, fallback: { starred?: boolean; rating?: number }) => ({
    starred: fallback?.starred ?? false,
    rating: fallback?.rating ?? 0,
    setFavorite: mockSetFavorite,
    setRating: mockSetRating,
  }),
}));

vi.mock('../hooks/usePreferences.js', () => ({
  usePreferences: () => ({ data: mockPreferences }),
  useUpdatePreferences: () => ({ mutate: mockUpdatePreferencesMutate }),
}));

beforeEach(() => {
  resetPlayer();
  resetNowPlaying();
  usePlayer.setState({ updateCurrentSong: mockUpdateCurrentSong } as any);
  mockPreferences.autoDjEnabled = false;
  mockPreferences.autoDjMode = 'smart';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PlayerBar', () => {
  it('disables favorite and rating when no track is playing', () => {
    render(<PlayerBar />);
    expect((screen.getByRole('button', { name: /add favorite/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /rate 3 stars/i }));
    expect(mockSetRating).not.toHaveBeenCalled();
  });

  it('renders favorite and rating for the current song', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist', starred: true, rating: 4 } as any,
    ], 0);

    render(<PlayerBar />);
    expect(screen.getByText('Now Playing')).toBeTruthy();
    expect((screen.getByRole('button', { name: /remove favorite/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls setFavorite when the favorite button is clicked', async () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist', starred: false, rating: 0 } as any,
    ], 0);

    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: /add favorite/i }));
    expect(mockSetFavorite).toHaveBeenCalledWith(true);
    await waitFor(() => expect(mockUpdateCurrentSong).toHaveBeenCalledWith({ starred: true }));
  });

  it('calls setRating when a star is clicked', async () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist', starred: false, rating: 0 } as any,
    ], 0);

    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: /rate 3 stars/i }));
    expect(mockSetRating).toHaveBeenCalledWith(3);
    await waitFor(() => expect(mockUpdateCurrentSong).toHaveBeenCalledWith({ rating: 3 }));
  });

  it('renders separate clickable links for each artist', () => {
    usePlayer.getState().playQueue([
      {
        id: 's1',
        title: 'Now Playing',
        artistEntries: [
          { id: 'a1', name: 'Artist One' },
          { id: 'a2', name: 'Artist Two' },
        ],
      } as any,
    ], 0);

    render(<PlayerBar />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/artists/a1');
    expect(screen.getByText('Artist One')).toBeTruthy();
    expect(links[1].getAttribute('href')).toBe('/artists/a2');
    expect(screen.getByText('Artist Two')).toBeTruthy();
  });

  it('falls back to a single artist link when artistEntries is not available', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistId: 'a1', artistName: 'Artist One' } as any,
    ], 0);

    render(<PlayerBar />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/artists/a1');
    expect(screen.getByText('Artist One')).toBeTruthy();
  });

  it('renders a clickable year next to the album separated by a dot', () => {
    usePlayer.getState().playQueue([
      {
        id: 's1',
        title: 'Now Playing',
        albumName: 'Album',
        albumId: 'alb1',
        year: 2020,
      } as any,
    ], 0);

    render(<PlayerBar />);
    const albumLink = screen.getByRole('link', { name: 'Album' });
    const yearLink = screen.getByRole('link', { name: '2020' });
    expect(albumLink.getAttribute('href')).toBe('/albums/alb1');
    expect(yearLink.getAttribute('href')).toBe('/years/2020');
    expect(albumLink.parentElement?.textContent).toContain('·');
  });

  it('renders a clickable year when no album is present', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', year: 1999 } as any,
    ], 0);

    render(<PlayerBar />);
    const yearLink = screen.getByRole('link', { name: '1999' });
    expect(yearLink.getAttribute('href')).toBe('/years/1999');
  });

  it('toggles Auto DJ on click, persists the change, and updates its visual state', () => {
    render(<PlayerBar />);
    const djButton = screen.getByRole('button', { name: /auto dj/i });
    expect(djButton).toBeTruthy();
    expect(djButton.className).toContain('text-fg-secondary');
    expect(djButton.className).not.toContain('text-accent');
    expect(djButton.className).not.toContain('bg-accent/15');

    fireEvent.click(djButton);
    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ autoDjEnabled: true });

    mockPreferences.autoDjEnabled = true;
    cleanup();
    render(<PlayerBar />);
    const activeDjButton = screen.getByRole('button', { name: /auto dj/i });
    expect(activeDjButton.className).toContain('text-accent');
    expect(activeDjButton.className).toContain('bg-accent/15');

    fireEvent.click(activeDjButton);
    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ autoDjEnabled: false });
  });

  it('opens the DJ mode menu on right click', () => {
    render(<PlayerBar />);
    const djButton = screen.getByRole('button', { name: /auto dj/i });

    fireEvent.contextMenu(djButton);

    expect(screen.getByRole('menuitem', { name: 'Similar' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Random' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Smart' })).toBeTruthy();
  });

  it('selects a DJ mode and persists the change', () => {
    render(<PlayerBar />);
    const djButton = screen.getByRole('button', { name: /auto dj/i });

    fireEvent.contextMenu(djButton);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Random' }));

    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ autoDjMode: 'random' });
  });

  it('opens the Now Playing overlay when the cover art is clicked', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist', coverArt: 'cover-1' } as any,
    ], 0);

    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: /open now playing/i }));
    expect(useNowPlaying.getState().isOpen).toBe(true);
  });

  it('renders the queue button when a user is provided', () => {
    render(<PlayerBar user={mockUser} />, { wrapper: NotificationProvider });
    expect(screen.getByRole('button', { name: /queue/i })).toBeTruthy();
  });

  it('opens a floating queue modal and plays a queued track when double-clicked', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist' } as any,
      { id: 's2', title: 'Up Next', artistName: 'Artist' } as any,
    ], 0);

    render(<PlayerBar user={mockUser} />, { wrapper: NotificationProvider });
    fireEvent.click(screen.getByRole('button', { name: /queue/i }));

    expect(screen.getByRole('dialog', { name: /queue/i })).toBeTruthy();
    fireEvent.doubleClick(screen.getByText('Up Next'));
    expect(usePlayer.getState().currentSong?.id).toBe('s2');
  });

  it('closes the floating queue modal when the close button is clicked', async () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist' } as any,
      { id: 's2', title: 'Up Next', artistName: 'Artist' } as any,
    ], 0);

    render(<PlayerBar user={mockUser} />, { wrapper: NotificationProvider });
    fireEvent.click(screen.getByRole('button', { name: /queue/i }));
    expect(screen.getByRole('dialog', { name: /queue/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /close queue/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /queue/i })).toBeFalsy();
    });
  });

  it('toggles shuffle and updates its visual state', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist' } as any,
    ], 0);

    render(<PlayerBar />);
    const shuffleButton = screen.getByRole('button', { name: 'Shuffle' });
    expect(shuffleButton.className).not.toContain('text-accent');
    expect(shuffleButton.className).not.toContain('bg-accent/15');

    fireEvent.click(shuffleButton);
    expect(usePlayer.getState().shuffle).toBe(true);

    cleanup();
    render(<PlayerBar />);
    const activeShuffleButton = screen.getByRole('button', { name: 'Shuffle' });
    expect(activeShuffleButton.className).toContain('text-accent');
    expect(activeShuffleButton.className).toContain('bg-accent/15');
  });

  it('cycles repeat mode and updates its icon and visual state', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist' } as any,
    ], 0);

    render(<PlayerBar />);
    const repeatButton = screen.getByRole('button', { name: /Repeat:/i });
    const repeatUse = repeatButton.querySelector('use');
    expect(repeatButton.className).not.toContain('text-accent');
    expect(repeatButton.className).not.toContain('bg-accent/15');
    expect(repeatUse?.getAttribute('href')).toBe('/mdi-sprite.svg?v=2#mdi-repeat');

    fireEvent.click(repeatButton);
    expect(usePlayer.getState().repeat).toBe('all');

    cleanup();
    render(<PlayerBar />);
    const allRepeatButton = screen.getByRole('button', { name: /Repeat: all/i });
    const allRepeatUse = allRepeatButton.querySelector('use');
    expect(allRepeatButton.className).toContain('text-accent');
    expect(allRepeatButton.className).toContain('bg-accent/15');
    expect(allRepeatUse?.getAttribute('href')).toBe('/mdi-sprite.svg?v=2#mdi-repeat');

    fireEvent.click(allRepeatButton);
    expect(usePlayer.getState().repeat).toBe('one');

    cleanup();
    render(<PlayerBar />);
    const oneRepeatButton = screen.getByRole('button', { name: /Repeat: one/i });
    const oneRepeatUse = oneRepeatButton.querySelector('use');
    expect(oneRepeatButton.className).toContain('text-accent');
    expect(oneRepeatButton.className).toContain('bg-accent/15');
    expect(oneRepeatUse?.getAttribute('href')).toBe('/mdi-sprite.svg?v=2#mdi-repeat-once');
  });
});
