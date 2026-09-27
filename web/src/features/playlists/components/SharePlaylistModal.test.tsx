import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SharePlaylistModal } from './SharePlaylistModal.js';
import { api } from '../../../lib/api.js';
import type { PlaylistDetail } from '../../../hooks/usePlaylist.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

vi.mock('../../../lib/api.js', () => ({
  api: vi.fn(),
}));

const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../../../contexts/NotificationContext.js', () => ({
  useNotification: () => mockNotify,
}));

const mockedApi = vi.mocked(api);

function makePlaylist(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
  return {
    id: 'playlist-1',
    name: 'Test Playlist',
    ownerId: 'user-1',
    ownerUsername: 'user-1',
    visibility: 'link',
    shareToken: 'tok-123',
    shareDownload: false,
    isSmart: false,
    resolveMode: 'tracks',
    songCount: 2,
    entries: [],
    starred: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderModal(playlist: PlaylistDetail) {
  return renderWithQueryClient(
    <SharePlaylistModal open onClose={vi.fn()} playlist={playlist} />,
  );
}

/** The links tab (where the download switch lives) needs a click first. */
async function openLinksTab() {
  fireEvent.click(screen.getByRole('tab', { name: /share links/i }));
  await screen.findByLabelText('Share link');
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SharePlaylistModal allow-download switch', () => {
  it('shows the switch reflecting the detail flag', async () => {
    renderModal(makePlaylist({ shareDownload: true }));
    await openLinksTab();

    const toggle = screen.getByRole('checkbox', { name: /allow download/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('PATCHes the flag without rotating the token and refreshes', async () => {
    const { queryClient } = renderModal(makePlaylist({ shareDownload: false }));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockedApi.mockResolvedValue({ shareDownload: true });
    await openLinksTab();

    fireEvent.click(screen.getByRole('checkbox', { name: /allow download/i }));

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1/share-link', {
        method: 'PATCH',
        body: JSON.stringify({ allowDownload: true }),
      }),
    );
    expect(mockNotify.notify).toHaveBeenCalledWith('Downloads enabled for this link', 'success');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['playlist', 'playlist-1'] });
  });

  it('round-trips a disable', async () => {
    renderModal(makePlaylist({ shareDownload: true }));
    mockedApi.mockResolvedValue({ shareDownload: false });
    await openLinksTab();

    fireEvent.click(screen.getByRole('checkbox', { name: /allow download/i }));

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1/share-link', {
        method: 'PATCH',
        body: JSON.stringify({ allowDownload: false }),
      }),
    );
    expect(mockNotify.notify).toHaveBeenCalledWith('Downloads disabled for this link', 'success');
  });

  it('notifies and leaves the state untouched when the PATCH fails', async () => {
    renderModal(makePlaylist({ shareDownload: false }));
    mockedApi.mockRejectedValue(new Error('server boom'));
    await openLinksTab();

    fireEvent.click(screen.getByRole('checkbox', { name: /allow download/i }));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('server boom', 'error'),
    );
  });

  it('hides the switch when no share link exists yet', async () => {
    renderModal(makePlaylist({ shareToken: undefined }));
    fireEvent.click(screen.getByRole('tab', { name: /share links/i }));

    expect(screen.queryByRole('checkbox', { name: /allow download/i })).toBeNull();
  });

  it('does not render the switch on the members tab', () => {
    renderModal(makePlaylist({ shareDownload: true }));

    expect(screen.queryByRole('checkbox', { name: /allow download/i })).toBeNull();
  });
});
