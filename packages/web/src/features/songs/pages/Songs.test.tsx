import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import type { User } from '@sonarly/shared';
import { Songs } from './Songs.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const playActions = vi.hoisted(() => ({
  playSong: vi.fn(),
  playSongs: vi.fn(),
  shufflePlay: vi.fn(),
  playNext: vi.fn(),
  addToQueue: vi.fn(),
}));

vi.mock('../../../hooks/usePlayActions.js', () => ({
  usePlayActions: () => playActions,
}));

const mockUser: User = {
  id: 'user-1',
  username: 'admin',
  isAdmin: true,
  createdAt: new Date().toISOString(),
};

function renderSongs() {
  return render(
    <Router>
      <NotificationProvider>
        <Songs user={mockUser} />
      </NotificationProvider>
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Songs', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/songs') {
        return {
          songs: [
            { id: 'song-1', title: 'Track One', artistName: 'Artist A', albumName: 'Album A', duration: 180 },
            { id: 'song-2', title: 'Track Two', artistName: 'Artist B', albumName: 'Album B', duration: 240 },
          ],
        };
      }
      if (path === '/me/preferences') {
        return { preferences: {} };
      }
      return {};
    });
  });

  it('renders the row context menu with Play and Edit items', async () => {
    renderSongs();

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });

    const rows = screen.getAllByRole('row');
    // First row is the header; data rows follow.
    const firstDataRow = rows[1];
    fireEvent.contextMenu(firstDataRow);

    const menu = screen.getByRole('menu');
    expect(menu).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /play$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /edit/i })).toBeTruthy();
  });

  it('does not render Edit in the context menu for non-admin users', async () => {
    render(
      <Router>
        <NotificationProvider>
          <Songs user={{ ...mockUser, isAdmin: false }} />
        </NotificationProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Track One')).toBeTruthy();
    });

    const rows = screen.getAllByRole('row');
    fireEvent.contextMenu(rows[1]);

    expect(screen.getByRole('menuitem', { name: /play$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /edit/i })).toBeFalsy();
  });
});
