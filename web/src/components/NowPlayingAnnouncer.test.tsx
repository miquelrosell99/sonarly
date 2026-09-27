import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { NowPlayingAnnouncer } from './NowPlayingAnnouncer.js';
import { usePlayer, resetPlayer } from '../stores/playerStore.js';

beforeEach(() => {
  resetPlayer();
});

afterEach(() => {
  cleanup();
});

describe('NowPlayingAnnouncer', () => {
  it('renders a polite live region', () => {
    render(<NowPlayingAnnouncer />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.className).toContain('sr-only');
  });

  it('is empty when nothing is playing', () => {
    render(<NowPlayingAnnouncer />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces the current track', () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song A', artistName: 'Artist' } as any], 0);
    render(<NowPlayingAnnouncer />);
    expect(screen.getByRole('status').textContent).toBe('Now playing: Song A by Artist');
  });

  it('falls back to Unknown artist when the artist name is missing', () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song A' } as any], 0);
    render(<NowPlayingAnnouncer />);
    expect(screen.getByRole('status').textContent).toBe('Now playing: Song A by Unknown artist');
  });

  it('updates the announcement when the track changes', () => {
    usePlayer
      .getState()
      .playQueue(
        [
          { id: 's1', title: 'Song A', artistName: 'Artist' } as any,
          { id: 's2', title: 'Song B', artistName: 'Artist' } as any,
        ],
        0,
      );
    render(<NowPlayingAnnouncer />);
    expect(screen.getByRole('status').textContent).toBe('Now playing: Song A by Artist');

    act(() => {
      usePlayer.getState().next();
    });
    expect(screen.getByRole('status').textContent).toBe('Now playing: Song B by Artist');
  });
});
