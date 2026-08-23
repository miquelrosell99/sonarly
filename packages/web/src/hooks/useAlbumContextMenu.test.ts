import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Album, Song } from '@sonarly/shared';
import { api } from '../lib/api.js';
import { useAlbumContextMenu } from './useAlbumContextMenu.js';

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

vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
}));

const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

function createHarness(album: Album) {
  return function AlbumMenuHarness() {
    const sections = useAlbumContextMenu(album);
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

const albumSongs: Song[] = [
  {
    id: 'song-1',
    filePath: '/music/album/01.mp3',
    title: 'First Track',
    duration: 200,
    mtime: 1,
    checksum: 'a',
  },
  {
    id: 'song-2',
    filePath: '/music/album/02.mp3',
    title: 'Second Track',
    duration: 220,
    mtime: 2,
    checksum: 'b',
  },
  {
    id: 'song-3',
    filePath: '/music/album/03.mp3',
    title: 'Third Track',
    duration: 240,
    mtime: 3,
    checksum: 'c',
  },
];

const album: Album = {
  id: 'album-1',
  name: 'Test Album',
  shownSongCount: 3,
};

describe('useAlbumContextMenu', () => {
  it('fetches album details and calls playSongs when Play is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ album, songs: albumSongs } as AlbumDetail);

    const Harness = createHarness(album);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/albums/album-1'));
    expect(playActions.playSongs).toHaveBeenCalledTimes(1);
    expect(playActions.playSongs).toHaveBeenCalledWith(albumSongs);
  });

  it('fetches album details and calls shufflePlay when Shuffle play is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ album, songs: albumSongs } as AlbumDetail);

    const Harness = createHarness(album);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('shuffle-play'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/albums/album-1'));
    expect(playActions.shufflePlay).toHaveBeenCalledTimes(1);
    expect(playActions.shufflePlay).toHaveBeenCalledWith(albumSongs);
  });

  it('shows Go to artist only when the album has an artistId and navigates when clicked', () => {
    const withoutArtist = createHarness(album);
    const { unmount } = render(React.createElement(withoutArtist));
    expect(screen.queryByTestId('go-to-artist')).toBeNull();
    unmount();

    const withArtist = createHarness({ ...album, artistId: 'artist-9' });
    render(React.createElement(withArtist));

    fireEvent.click(screen.getByTestId('go-to-artist'));
    expect(window.location.pathname).toBe('/artists/artist-9');
    window.history.pushState({}, '', '/');
  });

  it('fetches album details and calls playNext with all songs when Play next is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ album, songs: albumSongs } as AlbumDetail);

    const Harness = createHarness(album);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play-next'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/albums/album-1'));
    expect(playActions.playNext).toHaveBeenCalledTimes(1);
    expect(playActions.playNext).toHaveBeenCalledWith(albumSongs);
  });

  it('fetches album details and calls addToQueue with the songs when Add to queue is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ album, songs: albumSongs } as AlbumDetail);

    const Harness = createHarness(album);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('add-to-queue'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/albums/album-1'));
    expect(playActions.addToQueue).toHaveBeenCalledTimes(1);
    expect(playActions.addToQueue).toHaveBeenCalledWith(albumSongs);
  });

  it('disables playback items when shownSongCount is 0', () => {
    const emptyAlbum: Album = { id: 'album-2', name: 'Empty Album', shownSongCount: 0 };
    const Harness = createHarness(emptyAlbum);
    render(React.createElement(Harness));

    expect((screen.getByTestId('play') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('play-next') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('add-to-queue') as HTMLButtonElement).disabled).toBe(true);
  });

  it('notifies an error when fetching album details fails', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Network error'));

    const Harness = createHarness(album);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Network error', 'error'),
    );
    expect(playActions.playSongs).not.toHaveBeenCalled();
  });
});
