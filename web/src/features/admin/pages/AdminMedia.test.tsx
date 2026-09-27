import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { Router } from 'wouter';
import { AdminMedia } from './AdminMedia.js';
import { AdminRefreshProvider } from '../contexts/AdminRefreshContext.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import { renderWithQueryClient } from '../../../lib/testing.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: vi.fn(),
}));

const apiMock = vi.mocked(api);

// jsdom has no WAAPI (Element.prototype.animate); the toast animations need
// it (same stub as NotificationContext.test).
beforeAll(() => {
  Element.prototype.animate = vi.fn().mockReturnValue({
    cancel: vi.fn(),
    play: vi.fn(),
    set onfinish(_handler: (() => void) | null) {
      // Never fires in tests.
    },
  }) as unknown as typeof Element.prototype.animate;
});

const adminUser = {
  id: 'admin-1',
  username: 'admin',
  isAdmin: true,
} as never;

function mockSettingsLoad() {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/admin/status') {
      return { counts: { users: 2, songs: 10, albums: 3, artists: 4 } } as never;
    }
    if (path === '/settings/media') {
      if (init?.method === 'PATCH') return {} as never;
      return { duplicateStrategy: 'skip', reviewRetentionDays: 30 } as never;
    }
    return {} as never;
  });
}

describe('AdminMedia', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockSettingsLoad();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderPage() {
    return renderWithQueryClient(
      <Router>
        <NotificationProvider>
          <AdminRefreshProvider>
            <AdminMedia user={adminUser} />
          </AdminRefreshProvider>
        </NotificationProvider>
      </Router>,
    );
  }

  it('stages media settings and PATCHes only the changed field on save', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Default duplicate strategy')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Review folder cleanup'), { target: { value: '90' } });

    // Staged, not saved yet.
    expect(apiMock).not.toHaveBeenCalledWith(
      '/settings/media',
      expect.objectContaining({ method: 'PATCH' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/settings/media', {
        method: 'PATCH',
        body: JSON.stringify({ reviewRetentionDays: 90 }),
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    });
  });

  it('discards staged media settings without a request', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Default duplicate strategy')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Review folder cleanup'), { target: { value: '60' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect((screen.getByLabelText('Review folder cleanup') as HTMLSelectElement).value).toBe('30');
    expect(apiMock).not.toHaveBeenCalledWith(
      '/settings/media',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
