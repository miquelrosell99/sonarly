import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlayerBar } from './PlayerBar.js';
import { usePlayer, resetPlayer } from '../stores/playerStore.js';

const mockSetFavorite = vi.hoisted(() => vi.fn());
const mockSetRating = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSongInteraction.js', () => ({
  useSongInteraction: (songId: string | undefined, fallback: { starred?: boolean; rating?: number }) => ({
    starred: fallback?.starred ?? false,
    rating: fallback?.rating ?? 0,
    setFavorite: mockSetFavorite,
    setRating: mockSetRating,
  }),
}));

beforeEach(() => {
  resetPlayer();
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

  it('calls setFavorite when the favorite button is clicked', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist', starred: false, rating: 0 } as any,
    ], 0);

    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: /add favorite/i }));
    expect(mockSetFavorite).toHaveBeenCalledWith(true);
  });

  it('calls setRating when a star is clicked', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist', starred: false, rating: 0 } as any,
    ], 0);

    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: /rate 3 stars/i }));
    expect(mockSetRating).toHaveBeenCalledWith(3);
  });
});
