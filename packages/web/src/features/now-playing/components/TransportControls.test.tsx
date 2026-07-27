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

  it('toggles shuffle and updates its visual state', () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song' } as any], 0);
    render(<TransportControls />);
    const shuffleButton = screen.getByRole('button', { name: 'Shuffle' });
    expect(shuffleButton.className).not.toContain('text-accent');
    expect(shuffleButton.className).not.toContain('bg-accent/15');

    fireEvent.click(shuffleButton);
    expect(usePlayer.getState().shuffle).toBe(true);

    cleanup();
    render(<TransportControls />);
    const activeShuffleButton = screen.getByRole('button', { name: 'Shuffle' });
    expect(activeShuffleButton.className).toContain('text-accent');
    expect(activeShuffleButton.className).toContain('bg-accent/15');
  });

  it('cycles repeat mode and updates its icon and visual state', () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song' } as any], 0);
    render(<TransportControls />);
    const repeatButton = screen.getByRole('button', { name: /Repeat:/i });
    const repeatUse = repeatButton.querySelector('use');
    expect(repeatButton.className).not.toContain('text-accent');
    expect(repeatButton.className).not.toContain('bg-accent/15');
    expect(repeatUse?.getAttribute('href')).toBe('/mdi-sprite.svg#mdi-repeat');

    fireEvent.click(repeatButton);
    expect(usePlayer.getState().repeat).toBe('all');

    cleanup();
    render(<TransportControls />);
    const allRepeatButton = screen.getByRole('button', { name: /Repeat: all/i });
    const allRepeatUse = allRepeatButton.querySelector('use');
    expect(allRepeatButton.className).toContain('text-accent');
    expect(allRepeatButton.className).toContain('bg-accent/15');
    expect(allRepeatUse?.getAttribute('href')).toBe('/mdi-sprite.svg#mdi-repeat');

    fireEvent.click(allRepeatButton);
    expect(usePlayer.getState().repeat).toBe('one');

    cleanup();
    render(<TransportControls />);
    const oneRepeatButton = screen.getByRole('button', { name: /Repeat: one/i });
    const oneRepeatUse = oneRepeatButton.querySelector('use');
    expect(oneRepeatButton.className).toContain('text-accent');
    expect(oneRepeatButton.className).toContain('bg-accent/15');
    expect(oneRepeatUse?.getAttribute('href')).toBe('/mdi-sprite.svg#mdi-repeat-once');
  });
});
