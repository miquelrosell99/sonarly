import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Playlist, Song } from '@sonarly/shared';
import { api } from '../api.js';
import { usePlaylistContextMenu } from './usePlaylistContextMenu.js';

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

interface PlaylistDetail {
  playlist: Playlist & { songCount: number; entries: Song[] };
}

function createHarness(playlist: Playlist, onEdit: () => void, onConvert: () => void) {
  return function PlaylistMenuHarness() {
    const sections = usePlaylistContextMenu(playlist, onEdit, onConvert);
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

const playlistSongs: Song[] = [
  {
    id: 'song-1',
    filePath: '/music/playlist/01.mp3',
    title: 'First Track',
    duration: 200,
    mtime: 1,
    checksum: 'a',
  },
  {
    id: 'song-2',
    filePath: '/music/playlist/02.mp3',
    title: 'Second Track',
    duration: 220,
    mtime: 2,
    checksum: 'b',
  },
];

const basePlaylist: Playlist = {
  id: 'playlist-1',
  name: 'Test Playlist',
  ownerId: 'user-1',
  visibility: 'private',
  songIds: playlistSongs.map((s) => s.id),
  isSmart: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function makeDetail(playlist: Playlist): PlaylistDetail {
  return {
    playlist: {
      ...playlist,
      songCount: playlistSongs.length,
      entries: playlistSongs,
    },
  };
}

describe('usePlaylistContextMenu', () => {
  it('returns Playback and Edit sections and no Delete action', () => {
    const Harness = createHarness(basePlaylist, vi.fn(), vi.fn());
    render(React.createElement(Harness));

    expect(screen.getByTestId('play')).toBeTruthy();
    expect(screen.getByTestId('play-next')).toBeTruthy();
    expect(screen.getByTestId('add-to-queue')).toBeTruthy();
    expect(screen.getByTestId('edit')).toBeTruthy();
    expect(screen.queryByTestId('delete')).toBeNull();
  });

  it('shows Convert to normal playlist only for smart playlists', () => {
    const normalHarness = createHarness(basePlaylist, vi.fn(), vi.fn());
    const { unmount } = render(React.createElement(normalHarness));
    expect(screen.queryByTestId('convert')).toBeNull();
    unmount();

    const smartPlaylist: Playlist = { ...basePlaylist, isSmart: true };
    const smartHarness = createHarness(smartPlaylist, vi.fn(), vi.fn());
    render(React.createElement(smartHarness));
    expect(screen.getByTestId('convert')).toBeTruthy();
  });

  it('fetches playlist entries and calls playSongs when Play is clicked', async () => {
    mockedApi.mockResolvedValueOnce(makeDetail(basePlaylist));

    const Harness = createHarness(basePlaylist, vi.fn(), vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1'));
    expect(playActions.playSongs).toHaveBeenCalledTimes(1);
    expect(playActions.playSongs).toHaveBeenCalledWith(playlistSongs);
  });

  it('fetches playlist entries and calls playNext with all songs when Play next is clicked', async () => {
    mockedApi.mockResolvedValueOnce(makeDetail(basePlaylist));

    const Harness = createHarness(basePlaylist, vi.fn(), vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play-next'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1'));
    expect(playActions.playNext).toHaveBeenCalledTimes(1);
    expect(playActions.playNext).toHaveBeenCalledWith(playlistSongs);
  });

  it('fetches playlist entries and calls addToQueue with the songs when Add to queue is clicked', async () => {
    mockedApi.mockResolvedValueOnce(makeDetail(basePlaylist));

    const Harness = createHarness(basePlaylist, vi.fn(), vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('add-to-queue'));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1'));
    expect(playActions.addToQueue).toHaveBeenCalledTimes(1);
    expect(playActions.addToQueue).toHaveBeenCalledWith(playlistSongs);
  });

  it('calls onEdit when Edit is clicked', () => {
    const onEdit = vi.fn();
    const Harness = createHarness(basePlaylist, onEdit, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('calls PUT /api/playlists/:id with isSmart: false and onConvert when Convert is clicked', async () => {
    const smartPlaylist: Playlist = { ...basePlaylist, isSmart: true };
    const updatedPlaylist: Playlist = { ...smartPlaylist, isSmart: false };
    mockedApi.mockResolvedValueOnce({ playlist: updatedPlaylist });

    const onConvert = vi.fn();
    const Harness = createHarness(smartPlaylist, vi.fn(), onConvert);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('convert'));

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1', {
        method: 'PUT',
        body: JSON.stringify({ isSmart: false }),
      }),
    );
    expect(onConvert).toHaveBeenCalledTimes(1);
  });

  it('notifies an error when fetching playlist entries fails', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Network error'));

    const Harness = createHarness(basePlaylist, vi.fn(), vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Network error', 'error'),
    );
    expect(playActions.playSongs).not.toHaveBeenCalled();
  });

  it('notifies an error when converting a playlist fails', async () => {
    const smartPlaylist: Playlist = { ...basePlaylist, isSmart: true };
    mockedApi.mockRejectedValueOnce(new Error('Save failed'));

    const onConvert = vi.fn();
    const Harness = createHarness(smartPlaylist, vi.fn(), onConvert);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('convert'));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Save failed', 'error'),
    );
    expect(onConvert).not.toHaveBeenCalled();
  });
});
