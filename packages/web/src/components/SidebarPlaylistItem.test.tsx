import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Playlist } from '@sonarly/shared';
import { api } from '../lib/api.js';
import { SidebarPlaylistItem } from './SidebarPlaylistItem.js';

const playActions = vi.hoisted(() => ({
  playSong: vi.fn(),
  playSongs: vi.fn(),
  shufflePlay: vi.fn(),
  playNext: vi.fn(),
  addToQueue: vi.fn(),
}));

vi.mock('../hooks/usePlayActions.js', () => ({
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

const playlist: Playlist = {
  id: 'playlist-1',
  name: 'Test Playlist',
  ownerId: 'user-1',
  visibility: 'private',
  songIds: [],
  isSmart: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function renderItem({ isOwner = true, active = false } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(SidebarPlaylistItem, {
        playlist,
        href: `/playlists/${playlist.id}`,
        active,
        isOwner,
      }),
    ),
  );
  return { invalidateSpy };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

describe('SidebarPlaylistItem', () => {
  it('opens a context menu with playback, edit, share and delete items for the owner', () => {
    renderItem({ isOwner: true });

    fireEvent.contextMenu(screen.getByText('Test Playlist'));

    expect(screen.getByRole('menuitem', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Shuffle play' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Play next' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Add to queue' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Share…' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('hides Share and Delete for playlists owned by someone else', () => {
    renderItem({ isOwner: false });

    fireEvent.contextMenu(screen.getByText('Test Playlist'));

    expect(screen.getByRole('menuitem', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Share…' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('fetches playlist entries and plays them when Play is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ playlist: { ...playlist, songCount: 0, entries: [] } });
    renderItem();

    fireEvent.contextMenu(screen.getByText('Test Playlist'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play' }));

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1'));
    expect(playActions.playSongs).toHaveBeenCalledTimes(1);
  });

  it('deletes the playlist after confirmation, invalidates the list and navigates away', async () => {
    window.history.pushState({}, '', '/playlists/playlist-1');
    mockedApi.mockResolvedValueOnce({ ok: true });
    const { invalidateSpy } = renderItem({ isOwner: true, active: true });

    fireEvent.contextMenu(screen.getByText('Test Playlist'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    // ConfirmModal asks for confirmation first
    expect(screen.getByText('Delete playlist')).toBeTruthy();
    expect(mockedApi).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1', { method: 'DELETE' }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['playlists'] }),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/playlists'));
    expect(mockNotify.notify).toHaveBeenCalledWith('Deleted playlist "Test Playlist"', 'success');
  });

  it('stays on the current page when deleting a playlist that is not being viewed', async () => {
    window.history.pushState({}, '', '/albums');
    mockedApi.mockResolvedValueOnce({ ok: true });
    renderItem({ isOwner: true });

    fireEvent.contextMenu(screen.getByText('Test Playlist'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/playlists/playlist-1', { method: 'DELETE' }),
    );
    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Deleted playlist "Test Playlist"', 'success'),
    );
    expect(window.location.pathname).toBe('/albums');
  });

  it('notifies an error when deletion fails', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Server error'));
    renderItem({ isOwner: true });

    fireEvent.contextMenu(screen.getByText('Test Playlist'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockNotify.notify).toHaveBeenCalledWith('Server error', 'error'),
    );
  });
});
