import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Artist, Song } from '@sonarly/shared';
import { api } from '../api.js';
import { useArtistContextMenu } from './useArtistContextMenu.js';

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

const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../contexts/NotificationContext.js', () => ({
  useNotification: () => mockNotify,
}));

vi.mock('../api.js', () => ({
  api: vi.fn(),
}));

const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createHarness(artist: Artist, onEdit: () => void) {
  return function ArtistMenuHarness() {
    const sections = useArtistContextMenu(artist, onEdit);
    return React.createElement(
      'div',
      { 'data-testid': 'menu' },
      sections.flatMap((section, sectionIndex) =>
        section.items.map((item) =>
          React.createElement('button', {
            key: item.id,
            'data-testid': item.id,
            'data-section': String(sectionIndex),
            disabled: item.disabled,
            onClick: item.onClick,
          }, item.label),
        ),
      ),
    );
  };
}

const artistSongs: Song[] = [
  {
    id: 'song-1',
    filePath: '/music/artist/01.mp3',
    title: 'First Track',
    duration: 200,
    mtime: 1,
    checksum: 'a',
  },
  {
    id: 'song-2',
    filePath: '/music/artist/02.mp3',
    title: 'Second Track',
    duration: 220,
    mtime: 2,
    checksum: 'b',
  },
];

const artist: Artist = {
  id: 'artist-1',
  name: 'Test Artist',
};

describe('useArtistContextMenu', () => {
  it('returns Playback and Edit sections and no Delete action', () => {
    const Harness = createHarness(artist, vi.fn());
    render(React.createElement(Harness));

    expect(screen.getByTestId('play')).toBeTruthy();
    expect(screen.getByTestId('play-next')).toBeTruthy();
    expect(screen.getByTestId('add-to-queue')).toBeTruthy();
    expect(screen.getByTestId('edit')).toBeTruthy();
    expect(screen.queryByTestId('delete')).toBeNull();
  });

  it('fetches artist songs and calls playSongs when Play is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ songs: artistSongs });

    const Harness = createHarness(artist, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/artists/artist-1/songs'));
    expect(playActions.playSongs).toHaveBeenCalledTimes(1);
    expect(playActions.playSongs).toHaveBeenCalledWith(artistSongs);
  });

  it('fetches artist songs and calls playNext with all songs when Play next is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ songs: artistSongs });

    const Harness = createHarness(artist, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play-next'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/artists/artist-1/songs'));
    expect(playActions.playNext).toHaveBeenCalledTimes(1);
    expect(playActions.playNext).toHaveBeenCalledWith(artistSongs);
  });

  it('fetches artist songs and calls addToQueue with the songs when Add to queue is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ songs: artistSongs });

    const Harness = createHarness(artist, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('add-to-queue'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/artists/artist-1/songs'));
    expect(playActions.addToQueue).toHaveBeenCalledTimes(1);
    expect(playActions.addToQueue).toHaveBeenCalledWith(artistSongs);
  });

  it('calls onEdit when Edit is clicked', () => {
    const onEdit = vi.fn();
    const Harness = createHarness(artist, onEdit);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('notifies an error when fetching artist songs fails', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Network error'));

    const Harness = createHarness(artist, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Network error', 'error'),
    );
    expect(playActions.playSongs).not.toHaveBeenCalled();
  });
});
