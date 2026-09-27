import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Song } from '../types';
import { usePlayShuffleMenuSections } from './usePlayShuffleMenuSections.js';

const playActions = vi.hoisted(() => ({
  playSong: vi.fn(),
  playSongs: vi.fn(),
  shufflePlay: vi.fn(),
  playNext: vi.fn(),
  addToQueue: vi.fn(),
}));

vi.mock('./usePlayActions.js', () => ({
  usePlayActions: () => playActions,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const songs: Song[] = [
  {
    id: 'song-1',
    title: 'First Track',
    duration: 200,
    mtime: 1,
    explicit: false,
    active: true,
    starred: false,
    coverArtMissing: false,
    gapless: false,
  },
];

function createHarness(tracks: Song[]) {
  return function PlayShuffleMenuHarness() {
    const sections = usePlayShuffleMenuSections(tracks);
    return React.createElement(
      'div',
      { 'data-testid': 'menu' },
      sections.flatMap((section) =>
        section.items.map((item) =>
          React.createElement(
            'button',
            {
              key: item.id,
              'data-testid': item.id,
              disabled: item.disabled,
              onClick: item.onClick,
            },
            item.label,
          ),
        ),
      ),
    );
  };
}

describe('usePlayShuffleMenuSections', () => {
  it('returns Play all / Shuffle play items wired to the track list', () => {
    const Harness = createHarness(songs);
    render(React.createElement(Harness));

    const play = screen.getByTestId('play') as HTMLButtonElement;
    const shuffle = screen.getByTestId('shuffle-play') as HTMLButtonElement;
    expect(play.disabled).toBe(false);
    expect(shuffle.disabled).toBe(false);

    fireEvent.click(play);
    expect(playActions.playSongs).toHaveBeenCalledWith(songs);

    fireEvent.click(shuffle);
    expect(playActions.shufflePlay).toHaveBeenCalledWith(songs);
  });

  it('disables both items for an empty track list', () => {
    const Harness = createHarness([]);
    render(React.createElement(Harness));

    expect((screen.getByTestId('play') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('shuffle-play') as HTMLButtonElement).disabled).toBe(true);
  });
});
