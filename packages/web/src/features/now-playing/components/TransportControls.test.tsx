import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TransportControls } from './TransportControls.js';
import { usePlayer, resetPlayer } from '../../../stores/playerStore.js';

beforeEach(() => {
  resetPlayer();
});

afterEach(() => {
  cleanup();
});

describe('TransportControls', () => {
  it('disables controls when no song is loaded', () => {
    render(<TransportControls />);
    expect((screen.getByRole('button', { name: /play/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /previous/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /next/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('toggles play/pause when a song is loaded', () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song' } as any], 0);
    render(<TransportControls />);
    const pauseButton = screen.getByRole('button', { name: /pause/i });
    fireEvent.click(pauseButton);
    expect(usePlayer.getState().status).toBe('paused');
    const playButton = screen.getByRole('button', { name: /play/i });
    fireEvent.click(playButton);
    expect(usePlayer.getState().status).toBe('playing');
  });
});
