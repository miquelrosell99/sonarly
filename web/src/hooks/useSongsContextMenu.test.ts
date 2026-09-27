import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Song } from '../types';
import { api } from '../lib/api.js';
import { downloadSongs } from '../lib/download.js';
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

const libraryMutation = vi.hoisted(() => ({
  invalidate: vi.fn(),
  run: vi.fn(),
}));

// The mock mimics useMutation's onSettled: exactly ONE invalidation per run,
// success or failure — the property the delete flow is pinned to.
vi.mock('./useLibraryMutation.js', () => ({
  invalidateLibraryEntity: libraryMutation.invalidate,
  useLibraryMutation: () => ({
    isPending: false,
    run: libraryMutation.run,
  }),
}));

vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
}));

const mockedApi = vi.mocked(api);
const mockedDownloadSongs = vi.mocked(downloadSongs);

function wireRun(ok = true) {
  libraryMutation.run.mockImplementation((task: () => Promise<unknown>) =>
    task()
      .then(() => {
        libraryMutation.invalidate();
        return ok;
      })
      .catch(() => {
        libraryMutation.invalidate();
        return false;
      }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

function createHarness(songs: Song[], onEdit: () => void, isAdmin?: boolean, options?: { allowDownload?: boolean }) {
  return function SongsMenuHarness() {
    const sections = useSongsContextMenu(songs, onEdit, isAdmin, options);
    return React.createElement(
      'div',
      { 'data-testid': 'menu' },
      sections.flatMap((section) =>
        section.items.map((item) =>
          React.createElement('button', {
            key: item.id,
            'data-testid': item.id,
            'data-variant': item.variant,
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
  title: 'Track One',
  duration: 180,
  albumId: 'album-1',
  artistId: 'artist-1',
  mtime: 1,
  explicit: false,
  active: true,
  starred: false,
  coverArtMissing: false,
  gapless: false,
};

const otherSong: Song = {
  id: 'song-2',
  title: 'Track Two',
  duration: 200,
  mtime: 2,
  explicit: false,
  active: true,
  starred: false,
  coverArtMissing: false,
  gapless: false,
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

  it('shows a single-song Download and packs that song when clicked', () => {
    const Harness = createHarness([song], vi.fn());
    render(React.createElement(Harness));

    const download = screen.getByTestId('download');
    expect(download.textContent).toBe('Download');
    fireEvent.click(download);
    expect(mockedDownloadSongs).toHaveBeenCalledWith(['song-1']);
  });

  it('labels the ZIP download with the track count for multi-selections', () => {
    const Harness = createHarness([song, otherSong], vi.fn());
    render(React.createElement(Harness));

    const download = screen.getByTestId('download');
    expect(download.textContent).toBe('Download 2 tracks');
    fireEvent.click(download);
    expect(mockedDownloadSongs).toHaveBeenCalledWith(['song-1', 'song-2']);
  });

  it('hides Download when allowDownload is false', () => {
    const Harness = createHarness([song], vi.fn(), true, { allowDownload: false });
    render(React.createElement(Harness));

    expect(screen.queryByTestId('download')).toBeNull();
  });

  it('hides Download from share-token guests unless the playlist flag is passed', () => {
    window.history.pushState({}, '', '/playlists/pl-1?shareToken=tok');

    const HarnessNoFlag = createHarness([song], vi.fn());
    const { unmount } = render(React.createElement(HarnessNoFlag));
    expect(screen.queryByTestId('download')).toBeNull();
    unmount();

    const HarnessFlagged = createHarness([song], vi.fn(), true, { allowDownload: true });
    render(React.createElement(HarnessFlagged));
    expect(screen.getByTestId('download')).toBeTruthy();
  });

  it('shows no Delete item for non-admins', () => {
    const Harness = createHarness([song, otherSong], vi.fn(), false);
    render(React.createElement(Harness));

    expect(screen.queryByTestId('delete')).toBeNull();
  });

  it('deletes each selected track after confirm, invalidates once, and toasts', async () => {
    wireRun();
    mockedApi.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const Harness = createHarness([song, otherSong], vi.fn(), true);
    render(React.createElement(Harness));

    const deleteButton = screen.getByTestId('delete');
    expect(deleteButton.textContent).toBe('Delete 2 tracks');
    expect(deleteButton.getAttribute('data-variant')).toBe('danger');
    fireEvent.click(deleteButton);

    await waitFor(() => expect(mockNotify.notify).toHaveBeenCalledWith('Deleted 2 tracks', 'success'));
    expect(mockedApi).toHaveBeenCalledTimes(2);
    expect(mockedApi).toHaveBeenNthCalledWith(1, '/songs/song-1', { method: 'DELETE' });
    expect(mockedApi).toHaveBeenNthCalledWith(2, '/songs/song-2', { method: 'DELETE' });
    expect(libraryMutation.invalidate).toHaveBeenCalledTimes(1);
  });

  it('deletes a single selected track with a singular confirm and toast', async () => {
    wireRun();
    mockedApi.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const Harness = createHarness([song], vi.fn(), true);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('delete'));

    expect(confirmSpy).toHaveBeenCalledWith('Delete 1 track? This cannot be undone.');
    await waitFor(() => expect(mockNotify.notify).toHaveBeenCalledWith('Deleted 1 track', 'success'));
    expect(mockedApi).toHaveBeenCalledTimes(1);
  });

  it('deletes nothing when the confirm is cancelled', () => {
    wireRun();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const Harness = createHarness([song, otherSong], vi.fn(), true);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('delete'));

    expect(mockedApi).not.toHaveBeenCalled();
    expect(libraryMutation.invalidate).not.toHaveBeenCalled();
    expect(mockNotify.notify).not.toHaveBeenCalled();
  });

  it('notifies nothing on failure (the mutation wrapper toasts the error)', async () => {
    wireRun();
    mockedApi.mockRejectedValue(new Error('boom'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const Harness = createHarness([song], vi.fn(), true);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('delete'));

    await waitFor(() => expect(libraryMutation.invalidate).toHaveBeenCalledTimes(1));
    expect(mockNotify.notify).not.toHaveBeenCalled();
  });
});
