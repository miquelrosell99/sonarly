import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import type { User } from '@sonarly/shared';
import { AdminGenres } from './AdminGenres.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const mockUser: User = {
  id: 'user-1',
  username: 'admin',
  isAdmin: true,
  createdAt: new Date().toISOString(),
};

function renderAdminGenres(user = mockUser) {
  return render(
    <Router>
      <NotificationProvider>
        <AdminGenres user={user} />
      </NotificationProvider>
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminGenres', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/genres') {
        return {
          genres: [
            { id: 'g1', name: 'Rock', parentId: undefined, path: 'Rock', active: true },
            { id: 'g2', name: 'Classic Rock', parentId: 'g1', path: 'Rock > Classic Rock', active: true },
            { id: 'g3', name: 'Jazz', parentId: undefined, path: 'Jazz', active: true },
          ],
        };
      }
      if (path === '/genres/tree') {
        return {
          tree: [
            {
              id: 'g1',
              name: 'Rock',
              parentId: undefined,
              path: 'Rock',
              active: true,
              children: [
                {
                  id: 'g2',
                  name: 'Classic Rock',
                  parentId: 'g1',
                  path: 'Rock > Classic Rock',
                  active: true,
                  children: [],
                },
              ],
            },
            {
              id: 'g3',
              name: 'Jazz',
              parentId: undefined,
              path: 'Jazz',
              active: true,
              children: [],
            },
          ],
        };
      }
      if (path === '/genres' && options?.method === 'POST') {
        return { genre: { id: 'g4', name: 'Blues', active: true } };
      }
      if (path === '/genres/g2' && options?.method === 'PUT') {
        return { genre: { id: 'g2', name: 'Vintage Rock', active: true } };
      }
      if (path === '/genres/g2' && options?.method === 'DELETE') {
        return { ok: true };
      }
      return {};
    });
  });

  it('renders the genre tree', async () => {
    renderAdminGenres();

    await waitFor(() => {
      expect(screen.getByText('Rock')).toBeTruthy();
    });

    expect(screen.getByText('Classic Rock')).toBeTruthy();
    expect(screen.getByText('Rock > Classic Rock')).toBeTruthy();
    expect(screen.getByText('Jazz')).toBeTruthy();
  });

  it('creates a root genre', async () => {
    renderAdminGenres();

    await waitFor(() => {
      expect(screen.getByText('Rock')).toBeTruthy();
    });

    const rootInput = screen.getByLabelText(/new root genre/i);
    fireEvent.change(rootInput, { target: { value: 'Blues' } });
    fireEvent.click(screen.getByRole('button', { name: /create root/i }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/genres', {
        method: 'POST',
        body: JSON.stringify({ name: 'Blues' }),
      });
    });
  });

  it('renames a genre', async () => {
    renderAdminGenres();

    await waitFor(() => {
      expect(screen.getByText('Classic Rock')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /rename classic rock/i }));

    const renameInput = screen.getByDisplayValue('Classic Rock');
    fireEvent.change(renameInput, { target: { value: 'Vintage Rock' } });
    fireEvent.click(screen.getByRole('button', { name: /save rename of classic rock/i }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/genres/g2', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Vintage Rock' }),
      });
    });
  });

  it('deletes a leaf genre after confirm', async () => {
    renderAdminGenres();

    await waitFor(() => {
      expect(screen.getByText('Classic Rock')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /delete classic rock/i }));
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/genres/g2', { method: 'DELETE' });
    });
  });
});
