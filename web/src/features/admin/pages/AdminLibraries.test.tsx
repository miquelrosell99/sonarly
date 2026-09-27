import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Library, User } from '../../../types';
import { AdminLibraries } from './AdminLibraries.js';
import { useLibraries } from '../../../hooks/useLibraryLists.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }));

// The real provider's toast animation (card.animate) is not implemented in
// jsdom and its uncaught effect error unmounts the whole tree under test.
vi.mock('../../../contexts/NotificationContext.js', () => ({
  useNotification: () => mockNotify,
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUser: User = {
  id: 'user-1',
  username: 'admin',
  isAdmin: true,
  createdAt: new Date().toISOString(),
};

function makeLibrary(id: string, name: string): Library {
  return {
    id,
    name,
    path: `/media/${id}`,
    organizePattern: '{artist}/{album}/{title}',
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// The sidebar/TopBar selector consumes useLibraries; mounting it next to the
// admin page asserts the ['libraries'] cache — not just the page's local
// list — picks up CRUD.
function SelectorProbe() {
  const { data } = useLibraries();
  return <div data-testid="selector-libraries">{data?.libraries.map((l) => l.name).join(',')}</div>;
}

function renderAdminLibraries(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <AdminLibraries user={mockUser} />
          <SelectorProbe />
        </Router>
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminLibraries (Phase 10e: CRUD refreshes the selector)', () => {
  // Mutable stand-ins for the server tables; the /libraries endpoint serves
  // the selector, /admin/libraries the page's own list.
  let selectorLibraries: Library[];
  let adminLibraries: Library[];

  beforeEach(() => {
    selectorLibraries = [makeLibrary('lib-1', 'Main')];
    adminLibraries = [makeLibrary('lib-1', 'Main')];
    mockApi.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/libraries') return { libraries: selectorLibraries };
      if (path === '/admin/libraries' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body)) as { name: string; path: string };
        const created = makeLibrary('lib-2', body.name);
        selectorLibraries = [...selectorLibraries, created];
        adminLibraries = [...adminLibraries, created];
        return {};
      }
      if (path === '/admin/libraries') return { libraries: adminLibraries };
      return {};
    });
  });

  it('selector reflects a created library after invalidation, without a reload', async () => {
    renderAdminLibraries();

    await waitFor(() => {
      expect(screen.getByTestId('selector-libraries').textContent).toBe('Main');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Library' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/media/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Library' }));

    await waitFor(() => {
      expect(screen.getByTestId('selector-libraries').textContent).toBe('Main,New');
    });
  });
});
