import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Song, User } from '../../../types';
import { Track } from './Track.js';
import { renderWithQueryClient, createTestQueryClient } from '../../../lib/testing.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../../../contexts/NotificationContext.js', () => ({
  useNotification: () => mockNotify,
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const makeSong = (id: string): Song =>
  ({
    id,
    title: `Song ${id}`,
    artistId: 'ar-1',
    artistName: 'Artist One',
    albumId: 'al-1',
    albumName: 'Album One',
    year: 2020,
    genre: 'Rock',
    duration: 200,
    starred: false,
    explicit: false,
    mtime: 0,
    active: true,
    coverArtMissing: false,
    gapless: false,
  }) as Song;

const user = { id: 'u1', username: 'tester', isAdmin: false } as User;
const admin = { id: 'u2', username: 'admin', isAdmin: true } as User;

function renderTrack(path: string, queryClient = createTestQueryClient(), viewer: User = user) {
  const location = memoryLocation({ path, record: true });
  return {
    location,
    ...renderWithQueryClient(
      <Router hook={location.hook}>
        <NotificationProvider>
          <Route path="/tracks/:id">{() => <Track user={viewer} />}</Route>
        </NotificationProvider>
      </Router>,
      queryClient,
    ),
  };
}

const songCalls = () => mockApi.mock.calls.filter((call) => String(call[0]).startsWith('/songs/'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Track detail (react-query, P5)', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs/')) {
        return { song: makeSong(path.split('/')[2]) };
      }
      return {};
    });
  });

  it('serves a remount from the cache without refetching', async () => {
    const queryClient = createTestQueryClient();
    const first = renderTrack('/tracks/t1', queryClient);
    await screen.findByText('Song t1');
    first.unmount();

    renderTrack('/tracks/t1', queryClient);
    await screen.findByText('Song t1');

    expect(songCalls()).toHaveLength(1);
  });

  it('renders the error state with retry; retrying refetches and recovers', async () => {
    let fail = true;
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs/')) {
        if (fail) throw new Error('Network down');
        return { song: makeSong('t1') };
      }
      return {};
    });

    renderTrack('/tracks/t1');

    expect((await screen.findByRole('alert')).textContent).toContain('Network down');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('Song t1');
    expect(screen.queryByRole('alert')).toBeFalsy();
    expect(songCalls()).toHaveLength(2);
  });

  it('fetches the new id on navigation and cannot be clobbered by a late previous response', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    mockApi.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path.startsWith('/songs/')) {
            pending.set(path.split('/')[2], resolve);
            return;
          }
          resolve({});
        }),
    );

    const { location } = renderTrack('/tracks/t1');
    await waitFor(() => expect(pending.has('t1')).toBe(true));

    act(() => location.navigate('/tracks/t2'));
    await waitFor(() => expect(pending.has('t2')).toBe(true));
    pending.get('t2')!({ song: makeSong('t2') });
    await screen.findByText('Song t2');

    // The t1 response lands late; the page must keep showing t2.
    pending.get('t1')!({ song: makeSong('t1') });
    await act(async () => {});

    expect(screen.getByText('Song t2')).toBeTruthy();
    expect(screen.queryByText('Song t1')).toBeFalsy();
  });

  it('invalidates the songs lists when the track is deleted', async () => {
    const queryClient = createTestQueryClient();
    const listKey = ['songs', 'list', { libraryId: null }] as const;
    queryClient.setQueryData(listKey, { songs: [makeSong('t1')] });

    renderTrack('/tracks/t1', queryClient);
    await screen.findByText('Song t1');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);

    await waitFor(() => {
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    });
    expect(mockApi.mock.calls.some((call) => String(call[0]) === '/songs/t1' && call[1]?.method === 'DELETE')).toBe(true);
  });

  it('applies the explicit-title policy on the detail page (F28)', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs/')) {
        return { song: { ...makeSong(path.split('/')[2]), explicit: true } };
      }
      return {};
    });

    const { unmount } = renderTrack('/tracks/t1');
    await screen.findByText('Song t1');
    expect(screen.getByRole('img', { name: 'Explicit' })).toBeTruthy();
    unmount();

    // blurExplicitTitles blurs the visible title but keeps the text rendered.
    const blurred = { ...user, blurExplicitTitles: true } as User;
    const location = memoryLocation({ path: '/tracks/t1' });
    renderWithQueryClient(
      <Router hook={location.hook}>
        <NotificationProvider>
          <Route path="/tracks/:id">{() => <Track user={blurred} />}</Route>
        </NotificationProvider>
      </Router>,
    );
    await screen.findByText('Song t1');
    expect(screen.getByRole('img', { name: 'Explicit' })).toBeTruthy();
    expect(screen.getByText('Song t1').closest('span')?.className).toContain('blur-sm');
  });
});

describe('Track detail header delete (admin)', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs/')) {
        return { song: makeSong(path.split('/')[2]) };
      }
      return {};
    });
  });

  it('hides the header Delete action from non-admins', async () => {
    renderTrack('/tracks/t1');

    await screen.findByText('Song t1');
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('lets an admin delete the track after confirmation: DELETE, invalidation, toast, navigation', async () => {
    const queryClient = createTestQueryClient();
    const listKey = ['songs', 'list', { libraryId: null }] as const;
    queryClient.setQueryData(listKey, { songs: [makeSong('t1')] });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { location } = renderTrack('/tracks/t1', queryClient, admin);

    await screen.findByText('Song t1');

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // ConfirmModal asks first; no DELETE request until confirmed
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete track')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/songs/t1', { method: 'DELETE' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/songs/t1', { method: 'DELETE' }));
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['songs'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['albums'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['artists'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['search'] });
    });
    expect(mockNotify.notify).toHaveBeenCalledWith('Deleted track "Song t1"', 'success');
    await waitFor(() => expect(location.history[location.history.length - 1]).toBe('/tracks'));
  });

  it('does not delete when the header confirm dialog is cancelled', async () => {
    renderTrack('/tracks/t1', createTestQueryClient(), admin);

    await screen.findByText('Song t1');

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockApi).not.toHaveBeenCalledWith('/songs/t1', { method: 'DELETE' });
  });

  it('offers Delete in the header context menu for admins and confirms before deleting', async () => {
    renderTrack('/tracks/t1', createTestQueryClient(), admin);

    await screen.findByText('Song t1');

    // Right-click on the title header opens the track menu
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Song t1' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete track')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/songs/t1', { method: 'DELETE' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/songs/t1', { method: 'DELETE' }));
  });

  it('omits Edit/Delete from the header context menu for non-admins', async () => {
    renderTrack('/tracks/t1');

    await screen.findByText('Song t1');

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Song t1' }));

    expect(screen.getByRole('menuitem', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });
});
