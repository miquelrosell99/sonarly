import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NowPlaying } from './NowPlaying.js';
import { useNowPlaying, resetNowPlaying } from '../stores/nowPlayingStore.js';
import { usePlayer, resetPlayer } from '../../../stores/playerStore.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import type { User } from '@sonarly/shared';

const mockUser = { id: 'u1', username: 'test', isAdmin: false } as User;

vi.mock('wouter', () => ({
  useLocation: () => [{}, vi.fn()],
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

beforeEach(() => {
  resetNowPlaying();
  resetPlayer();
});

afterEach(() => {
  cleanup();
});

describe('NowPlaying', () => {
  it('does not render when closed', () => {
    render(<NowPlaying user={mockUser} />, { wrapper: Wrapper });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders when open', () => {
    useNowPlaying.getState().open();
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song', artistName: 'Artist', albumName: 'Album' } as any], 0);
    render(<NowPlaying user={mockUser} />, { wrapper: Wrapper });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Song' })).toBeTruthy();
    expect(screen.getAllByText('Artist').length).toBeGreaterThan(0);
  });

  it('closes when the chevron button is clicked', () => {
    useNowPlaying.getState().open();
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song', artistName: 'Artist' } as any], 0);
    render(<NowPlaying user={mockUser} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: /close now playing/i }));
    expect(useNowPlaying.getState().isOpen).toBe(false);
  });

  it('closes on escape', () => {
    useNowPlaying.getState().open();
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song', artistName: 'Artist' } as any], 0);
    render(<NowPlaying user={mockUser} />, { wrapper: Wrapper });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useNowPlaying.getState().isOpen).toBe(false);
  });

  it('does not close when a queue context menu is open and Escape is pressed', () => {
    useNowPlaying.getState().open();
    usePlayer.getState().playQueue(
      [
        { id: 's1', title: 'Current', artistName: 'Artist' } as any,
        { id: 's2', title: 'Next', artistName: 'Artist' } as any,
      ],
      0,
    );
    render(<NowPlaying user={mockUser} />, { wrapper: Wrapper });
    const row = screen.getByText('Next').closest('[role="menuitem"]') ?? screen.getByText('Next').closest('div');
    if (row) {
      fireEvent.contextMenu(row);
    }
    expect(screen.queryByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useNowPlaying.getState().isOpen).toBe(true);
    expect(screen.queryByRole('menu')).toBeFalsy();
  });
});
