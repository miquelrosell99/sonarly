import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationProvider } from './contexts/NotificationContext.js';
import App from './App.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('./lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

// jsdom does not implement matchMedia; the theme store only queries it when
// resolving an 'auto' mode (see themeStore.test.ts for the same stub).
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  // jsdom has no EventSource; the post-login shell enables useServerEvents.
  vi.stubGlobal(
    'EventSource',
    class {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((error: Event) => void) | null = null;
      close() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function bootMocks() {
  // Boot: setup OK, /api/me 401 (logged out) -> login screen.
  mockApi.mockImplementation(async (path: string) => {
    switch (path) {
      case '/setup':
        return { needsSetup: false };
      case '/login':
        return { user: { id: 'user-b', username: 'userb', isAdmin: false } };
      case '/libraries':
        return { libraries: [] };
      case '/playlists':
        return { playlists: [] };
      case '/players':
        return { players: [] };
      default:
        return {};
    }
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/api/me')) {
        return { status: 401, ok: false, text: async () => '' } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function renderApp() {
  window.history.pushState({}, '', '/login');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('App auth-switch cache integrity', () => {
  it('clears the query cache when the session dies, so the next account never sees the previous one’s data', async () => {
    bootMocks();
    const { queryClient } = renderApp();

    // Login form visible == boot settled with user=null.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy();
    });

    // User A's cached server state (starred flags, preferences, …).
    queryClient.setQueryData(['songs', 'list', { libraryId: null }], {
      songs: [{ id: 'song-1', title: 'User A private song', starred: true }],
    });
    queryClient.setQueryData(['me', 'preferences'], { preferences: { blurExplicitTitles: true } });
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);

    window.dispatchEvent(new Event('sonarly:unauthorized'));

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy();
    });
  });

  it('clears the query cache again when the next account logs in', async () => {
    bootMocks();
    const { queryClient } = renderApp();
    const clearSpy = vi.spyOn(queryClient, 'clear');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy();
    });

    // Stale rows that survived from the previous session for any reason must
    // not bleed into user B's first render.
    queryClient.setQueryData(['playlists'], { playlists: [{ id: 'p1', name: 'User A playlist' }] });

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'userb' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'userb', password: 'secret' }),
      });
    });
    expect(clearSpy).toHaveBeenCalled();
  });
});
