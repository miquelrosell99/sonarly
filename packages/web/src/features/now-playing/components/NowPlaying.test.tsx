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
  Link: ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
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
    fireEvent.contextMenu(screen.getByText('Next'));
    expect(screen.queryByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useNowPlaying.getState().isOpen).toBe(true);
    expect(screen.queryByRole('menu')).toBeFalsy();
  });

  it('renders clickable metadata links with correct hrefs', () => {
    useNowPlaying.getState().open();
    usePlayer.getState().playQueue(
      [
        {
          id: 's1',
          title: 'Song',
          artistId: 'a1',
          artistName: 'Artist',
          albumId: 'alb1',
          albumName: 'Album',
          year: 2020,
        } as any,
      ],
      0,
    );
    render(<NowPlaying user={mockUser} />, { wrapper: Wrapper });

    const titleLink = screen.getByRole('link', { name: 'Song' });
    const artistLink = screen.getByRole('link', { name: 'Artist' });
    const albumLink = screen.getByRole('link', { name: 'Album' });
    const yearLink = screen.getByRole('link', { name: '2020' });

    expect(titleLink.getAttribute('href')).toBe('/tracks/s1');
    expect(artistLink.getAttribute('href')).toBe('/artists/a1');
    expect(albumLink.getAttribute('href')).toBe('/albums/alb1');
    expect(yearLink.getAttribute('href')).toBe('/years/2020');
    expect(albumLink.parentElement?.textContent).toContain('·');
  });

  it('closes the dialog when a metadata link is clicked', () => {
    useNowPlaying.getState().open();
    usePlayer.getState().playQueue(
      [
        {
          id: 's1',
          title: 'Song',
          artistId: 'a1',
          artistName: 'Artist',
          albumId: 'alb1',
          albumName: 'Album',
          year: 2020,
        } as any,
      ],
      0,
    );
    render(<NowPlaying user={mockUser} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('link', { name: 'Song' }));
    expect(useNowPlaying.getState().isOpen).toBe(false);

    useNowPlaying.getState().open();
    fireEvent.click(screen.getByRole('link', { name: 'Artist' }));
    expect(useNowPlaying.getState().isOpen).toBe(false);

    useNowPlaying.getState().open();
    fireEvent.click(screen.getByRole('link', { name: 'Album' }));
    expect(useNowPlaying.getState().isOpen).toBe(false);

    useNowPlaying.getState().open();
    fireEvent.click(screen.getByRole('link', { name: '2020' }));
    expect(useNowPlaying.getState().isOpen).toBe(false);
  });

  it('does not render links when metadata ids are missing', () => {
    useNowPlaying.getState().open();
    usePlayer.getState().playQueue(
      [
        {
          id: 's1',
          title: 'Song',
          artistName: 'Artist',
          albumName: 'Album',
          year: 2020,
        } as any,
      ],
      0,
    );
    render(<NowPlaying user={mockUser} />, { wrapper: Wrapper });

    expect(screen.getByRole('link', { name: 'Song' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Artist' })).toBeFalsy();
    expect(screen.queryByRole('link', { name: 'Album' })).toBeFalsy();
    expect(screen.getByRole('link', { name: '2020' })).toBeTruthy();
  });
});
