import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Song } from '../types';
import { useSongContextMenu } from './useSongContextMenu.js';

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

const mockDownload = vi.hoisted(() => ({
  downloadTrackUrl: vi.fn((id: string) => `/api/stream/${id}?download=1`),
  saveUrl: vi.fn(),
  downloadSongs: vi.fn(),
}));

vi.mock('../lib/download.js', () => mockDownload);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

function createHarness(
  song: Song,
  onEdit: () => void,
  isAdmin = true,
  options?: { onDelete?: () => void; allowDownload?: boolean },
) {
  return function SongMenuHarness() {
    const sections = useSongContextMenu(song, onEdit, isAdmin, options);
    return React.createElement(
      'div',
      { 'data-testid': 'menu' },
      sections.map((section, sectionIndex) =>
        React.createElement(
          'div',
          { key: sectionIndex, 'data-section': String(sectionIndex) },
          section.title && React.createElement('div', { 'data-testid': `title-${sectionIndex}` }, section.title),
          section.items.map((item) =>
            React.createElement('button', {
              key: item.id,
              'data-testid': item.id,
              disabled: item.disabled,
              onClick: item.onClick,
            }, item.label),
          ),
        ),
      ),
    );
  };
}

const song: Song = {
  id: 'song-1',
  title: 'Track One',
  duration: 180,
  mtime: 1,
  explicit: false,
  active: true,
  starred: false,
  coverArtMissing: false,
  gapless: false,
};

describe('useSongContextMenu', () => {
  it('returns Playback and Edit sections with the expected items', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    expect(screen.getByTestId('play')).toBeTruthy();
    expect(screen.getByTestId('play-next')).toBeTruthy();
    expect(screen.getByTestId('add-to-queue')).toBeTruthy();
    expect(screen.getByTestId('edit')).toBeTruthy();
    expect(screen.getByText('Playback')).toBeTruthy();
  });

  it('calls playSong when Play is clicked', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));
    expect(playActions.playSong).toHaveBeenCalledTimes(1);
    expect(playActions.playSong).toHaveBeenCalledWith(song);
  });

  it('calls playNext when Play next is clicked', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play-next'));
    expect(playActions.playNext).toHaveBeenCalledTimes(1);
    expect(playActions.playNext).toHaveBeenCalledWith(song);
  });

  it('calls addToQueue with the song when Add to queue is clicked', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('add-to-queue'));
    expect(playActions.addToQueue).toHaveBeenCalledTimes(1);
    expect(playActions.addToQueue).toHaveBeenCalledWith([song]);
  });

  it('calls onEdit when Edit is clicked', () => {
    const onEdit = vi.fn();
    const Harness = createHarness(song, onEdit);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('shows Go to album and Go to artist when the song has ids and navigates', () => {
    const linkedSong: Song = { ...song, albumId: 'album-1', artistId: 'artist-1' };
    const Harness = createHarness(linkedSong, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('go-to-album'));
    expect(window.location.pathname).toBe('/albums/album-1');

    fireEvent.click(screen.getByTestId('go-to-artist'));
    expect(window.location.pathname).toBe('/artists/artist-1');
    window.history.pushState({}, '', '/');
  });

  it('omits navigation items when the song has no albumId or artistId', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    expect(screen.queryByTestId('go-to-album')).toBeNull();
    expect(screen.queryByTestId('go-to-artist')).toBeNull();
  });

  it('hides Edit item for non-admin users', () => {
    const Harness = createHarness(song, vi.fn(), false);
    render(React.createElement(Harness));

    expect(screen.queryByTestId('edit')).toBeFalsy();
    expect(screen.getByTestId('play')).toBeTruthy();
  });

  it('shows a danger Delete item when onDelete is provided for an admin', () => {
    const onDelete = vi.fn();
    const Harness = createHarness(song, vi.fn(), true, { onDelete });
    render(React.createElement(Harness));

    const deleteButton = screen.getByTestId('delete');
    expect(deleteButton.textContent).toBe('Delete');
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides the Delete item when no onDelete is provided', () => {
    const Harness = createHarness(song, vi.fn(), true);
    render(React.createElement(Harness));

    expect(screen.queryByTestId('delete')).toBeNull();
  });

  it('hides the Delete item from non-admins even when onDelete is provided', () => {
    const Harness = createHarness(song, vi.fn(), false, { onDelete: vi.fn() });
    render(React.createElement(Harness));

    expect(screen.queryByTestId('delete')).toBeNull();
  });

  it('shows Download for session viewers and saves the download URL', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    const download = screen.getByTestId('download');
    expect(download.textContent).toBe('Download');
    fireEvent.click(download);
    expect(mockDownload.downloadTrackUrl).toHaveBeenCalledWith('song-1');
    expect(mockDownload.saveUrl).toHaveBeenCalledWith('/api/stream/song-1?download=1');
  });

  it('hides Download when allowDownload is false', () => {
    const Harness = createHarness(song, vi.fn(), true, { allowDownload: false });
    render(React.createElement(Harness));

    expect(screen.queryByTestId('download')).toBeNull();
  });

  it('hides Download from share-token guests unless the playlist flag is passed', () => {
    window.history.pushState({}, '', '/playlists/pl-1?shareToken=tok');

    const HarnessNoFlag = createHarness(song, vi.fn());
    const { unmount } = render(React.createElement(HarnessNoFlag));
    expect(screen.queryByTestId('download')).toBeNull();
    unmount();

    const HarnessFlagged = createHarness(song, vi.fn(), true, { allowDownload: true });
    render(React.createElement(HarnessFlagged));
    expect(screen.getByTestId('download')).toBeTruthy();
  });
});
