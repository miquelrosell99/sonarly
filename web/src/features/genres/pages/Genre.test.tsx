import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { User } from '../../../types';
import { Genre } from './Genre.js';
import { renderWithQueryClient } from '../../../lib/testing.js';
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

const admin = { id: 'u1', username: 'admin', isAdmin: true } as User;
const nonAdmin = { id: 'u2', username: 'listener', isAdmin: false } as User;

function renderGenre(path: string, user: User | null = nonAdmin) {
  const loc = memoryLocation({ path, record: true });
  return {
    loc,
    ...renderWithQueryClient(
      <Router hook={loc.hook}>
        <NotificationProvider>
          <Route path="/genres/:genre">{() => <Genre user={user} />}</Route>
        </NotificationProvider>
      </Router>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Genre', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs')) {
        return { songs: [{ id: 'song-1', title: 'Genre Track', year: 2020 }] };
      }
      if (path.startsWith('/albums')) {
        return { albums: [{ id: 'album-1', name: 'Genre Album', year: 2020 }] };
      }
      if (path.startsWith('/genres')) {
        return { genres: [{ id: 'g1', name: 'Rock', path: 'Rock' }] };
      }
      return {};
    });
  });

  it('fetches the filtered songs/albums lists by server filter (loading → success)', async () => {
    renderGenre('/genres/Rock');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });
    expect(screen.getByText('Genre Album')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/songs?genre=Rock');
    expect(mockApi).toHaveBeenCalledWith('/albums?genre=Rock');
  });

  it('refetches under a new query key when the genre param changes', async () => {
    const { loc } = renderGenre('/genres/Rock');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });
    expect(mockApi).toHaveBeenCalledTimes(3);

    loc.navigate('/genres/Jazz');

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/songs?genre=Jazz');
      expect(mockApi).toHaveBeenCalledWith('/albums?genre=Jazz');
    });
    expect(mockApi.mock.calls.filter((call) => call[0] === '/songs?genre=Jazz')).toHaveLength(1);
  });

  it('drops its cache when the library:changed prefixes are invalidated (SSE contract)', async () => {
    const { queryClient } = renderGenre('/genres/Rock');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });
    const callsAfterLoad = mockApi.mock.calls.length;

    await queryClient.invalidateQueries({ queryKey: ['songs'] });
    await queryClient.invalidateQueries({ queryKey: ['albums'] });

    await waitFor(() => {
      expect(mockApi.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    });
  });

  it('opens a Play/Shuffle menu from the title header', async () => {
    renderGenre('/genres/Rock');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Rock' }));

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Play all' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Shuffle play' })).toBeTruthy();
  });

  it('hides Rename/Delete from non-admins', async () => {
    renderGenre('/genres/Rock', nonAdmin);

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Rock' }));

    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('lets an admin rename the genre and navigates to the new name', async () => {
    const { queryClient, loc } = renderGenre('/genres/Rock', admin);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Rock' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Genre name');
    fireEvent.change(input, { target: { value: 'Jazz' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/genres/g1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Jazz' }),
      }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['genres'] }),
    );
    await waitFor(() => expect(loc.history[loc.history.length - 1]).toBe('/genres/Jazz'));
    expect(mockNotify.notify).toHaveBeenCalledWith('Renamed genre to "Jazz"', 'success');
  });

  it('lets an admin delete the genre after confirmation and navigates away', async () => {
    const { queryClient, loc } = renderGenre('/genres/Rock', admin);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Rock' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    // ConfirmModal asks first; no DELETE request until confirmed
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete genre')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/genres/g1', { method: 'DELETE' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/genres/g1', { method: 'DELETE' }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['genres'] }),
    );
    await waitFor(() => expect(loc.history[loc.history.length - 1]).toBe('/genres'));
    expect(mockNotify.notify).toHaveBeenCalledWith('Deleted genre "Rock"', 'success');
  });

  it('does not delete the genre when the confirm dialog is cancelled', async () => {
    renderGenre('/genres/Rock', admin);

    await waitFor(() => {
      expect(screen.getByText('Genre Track')).toBeTruthy();
    });

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Rock' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockApi).not.toHaveBeenCalledWith('/genres/g1', { method: 'DELETE' });
  });
});
