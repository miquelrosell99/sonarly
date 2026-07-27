import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PlayerBar } from './PlayerBar.js';
import { usePlayer, resetPlayer } from '../stores/playerStore.js';
import { useNowPlaying, resetNowPlaying } from '../features/now-playing/index.js';

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

  it('toggles Auto DJ on click and persists the change', () => {
    render(<PlayerBar />);
    const djButton = screen.getByRole('button', { name: /auto dj/i });
    expect(djButton).toBeTruthy();

    fireEvent.click(djButton);
    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ autoDjEnabled: true });

    mockPreferences.autoDjEnabled = true;
    cleanup();
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: /auto dj/i }));
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
});
