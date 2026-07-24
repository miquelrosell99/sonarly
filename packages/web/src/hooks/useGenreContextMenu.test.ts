import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Song } from '@sonarly/shared';
import { api } from '../api.js';
import { useGenreContextMenu } from './useGenreContextMenu.js';

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

function createHarness(genre: string, tracks?: Song[]) {
  return function GenreMenuHarness() {
    const sections = useGenreContextMenu(genre, tracks);
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

const genreSongs: Song[] = [
  {
    id: 'song-1',
    filePath: '/music/genre/01.mp3',
    title: 'First Track',
    duration: 200,
    mtime: 1,
    checksum: 'a',
  },
  {
    id: 'song-2',
    filePath: '/music/genre/02.mp3',
    title: 'Second Track',
    duration: 220,
    mtime: 2,
    checksum: 'b',
  },
];

describe('useGenreContextMenu', () => {
  it('returns Playback section only and no Edit or Delete actions', () => {
    const Harness = createHarness('Rock');
    render(React.createElement(Harness));

    expect(screen.getByTestId('play')).toBeTruthy();
    expect(screen.getByTestId('play-next')).toBeTruthy();
    expect(screen.getByTestId('add-to-queue')).toBeTruthy();
    expect(screen.queryByTestId('edit')).toBeNull();
    expect(screen.queryByTestId('delete')).toBeNull();
  });

  it('uses provided tracks and calls playSongs when Play is clicked', () => {
    const Harness = createHarness('Rock', genreSongs);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));
    expect(mockedApi).not.toHaveBeenCalled();
    expect(playActions.playSongs).toHaveBeenCalledTimes(1);
    expect(playActions.playSongs).toHaveBeenCalledWith(genreSongs, 0);
  });

  it('uses provided tracks and calls playNext for each song in reverse order when Play next is clicked', () => {
    const Harness = createHarness('Rock', genreSongs);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play-next'));
    expect(playActions.playNext).toHaveBeenCalledTimes(genreSongs.length);
    expect(playActions.playNext).toHaveBeenNthCalledWith(1, genreSongs[1]);
    expect(playActions.playNext).toHaveBeenNthCalledWith(2, genreSongs[0]);
  });

  it('uses provided tracks and calls addToQueue with the tracks when Add to queue is clicked', () => {
    const Harness = createHarness('Rock', genreSongs);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('add-to-queue'));
    expect(playActions.addToQueue).toHaveBeenCalledTimes(1);
    expect(playActions.addToQueue).toHaveBeenCalledWith(genreSongs);
  });

  it('fetches songs by genre when tracks are not provided', async () => {
    mockedApi.mockResolvedValueOnce({ songs: genreSongs });

    const Harness = createHarness('Rock');
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/songs?genre=Rock'));
    expect(playActions.playSongs).toHaveBeenCalledTimes(1);
    expect(playActions.playSongs).toHaveBeenCalledWith(genreSongs, 0);
  });

  it('disables playback actions when provided tracks are empty', () => {
    const Harness = createHarness('Rock', []);
    render(React.createElement(Harness));

    expect((screen.getByTestId('play') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('play-next') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('add-to-queue') as HTMLButtonElement).disabled).toBe(true);
  });

  it('notifies an error when fetching songs by genre fails', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Network error'));

    const Harness = createHarness('Rock');
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Network error', 'error'),
    );
    expect(playActions.playSongs).not.toHaveBeenCalled();
  });
});
