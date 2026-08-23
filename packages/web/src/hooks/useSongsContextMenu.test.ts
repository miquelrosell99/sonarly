import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Song } from '@sonarly/shared';
import { useSongsContextMenu } from './useSongsContextMenu.js';

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
  window.history.pushState({}, '', '/');
});

function createHarness(songs: Song[], onEdit: () => void, isAdmin?: boolean) {
  return function SongsMenuHarness() {
    const sections = useSongsContextMenu(songs, onEdit, isAdmin);
    return React.createElement(
      'div',
      { 'data-testid': 'menu' },
      sections.flatMap((section) =>
        section.items.map((item) =>
          React.createElement('button', {
            key: item.id,
            'data-testid': item.id,
            disabled: item.disabled,
            onClick: item.onClick,
          }, item.label),
        ),
      ),
    );
  };
}

const song: Song = {
  id: 'song-1',
  filePath: '/music/track.mp3',
  title: 'Track One',
  duration: 180,
  albumId: 'album-1',
  artistId: 'artist-1',
  mtime: 1,
  checksum: 'abc',
};

const otherSong: Song = {
  id: 'song-2',
  filePath: '/music/other.mp3',
  title: 'Track Two',
  duration: 200,
  mtime: 2,
  checksum: 'def',
};

describe('useSongsContextMenu', () => {
  it('shows Go to album and Go to artist for a single song with ids and navigates', () => {
    const Harness = createHarness([song], vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('go-to-album'));
    expect(window.location.pathname).toBe('/albums/album-1');

    fireEvent.click(screen.getByTestId('go-to-artist'));
    expect(window.location.pathname).toBe('/artists/artist-1');
  });

  it('omits navigation items when the song has no albumId or artistId', () => {
    const bareSong: Song = { ...song, albumId: undefined, artistId: undefined };
    const Harness = createHarness([bareSong], vi.fn());
    render(React.createElement(Harness));

    expect(screen.queryByTestId('go-to-album')).toBeNull();
    expect(screen.queryByTestId('go-to-artist')).toBeNull();
  });

  it('omits navigation items for multi-song selections', () => {
    const Harness = createHarness([song, otherSong], vi.fn());
    render(React.createElement(Harness));

    expect(screen.getByTestId('play')).toBeTruthy();
    expect(screen.queryByTestId('go-to-album')).toBeNull();
    expect(screen.queryByTestId('go-to-artist')).toBeNull();
  });
});
