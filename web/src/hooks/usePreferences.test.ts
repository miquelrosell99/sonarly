import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserPreferences } from '../types';
import {
  __resetThemeSyncForTests,
  useSyncThemePreferences,
  useUpdatePreferences,
} from './usePreferences.js';
import { useTheme } from '../stores/themeStore.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
}));

const apiMock = vi.mocked(api);

// The server is the single source of truth (FF8): the response below
// deliberately disagrees with the requested values so the test proves the
// theme store is written from the RESPONSE, not the request payload.
const serverPreferences: UserPreferences = {
  themeMode: 'oled',
  accentColor: 'purple',
};

function Harness({ trigger }: { trigger: (mutate: (body: Partial<UserPreferences>) => void) => void }) {
  const mutation = useUpdatePreferences();
  trigger((body) => mutation.mutate(body));
  return null;
}

describe('useUpdatePreferences (FF8 single writer)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useTheme.setState({ themeMode: 'auto', accentColor: 'auto' });
    apiMock.mockResolvedValue({ preferences: serverPreferences } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('writes the theme store from the server response, not the request', async () => {
    let mutate: (body: Partial<UserPreferences>) => void = () => {};
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(Harness, { trigger: (m) => { mutate = m; } }),
      ),
    );

    mutate({ themeMode: 'dark' });

    await waitFor(() => {
      expect(useTheme.getState().themeMode).toBe('oled');
      expect(useTheme.getState().accentColor).toBe('purple');
    });
    expect(apiMock).toHaveBeenCalledWith('/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ themeMode: 'dark' }),
    });
  });

  it('seeds the query cache from the response instead of invalidating', async () => {
    let mutate: (body: Partial<UserPreferences>) => void = () => {};
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(Harness, { trigger: (m) => { mutate = m; } }),
      ),
    );

    mutate({ themeMode: 'dark' });

    await waitFor(() => {
      expect(queryClient.getQueryData(['me', 'preferences'])).toEqual({
        preferences: serverPreferences,
      });
    });
  });
});

describe('useSyncThemePreferences (boot seed, F3)', () => {
  let queryClient: QueryClient;

  function SyncHarness() {
    useSyncThemePreferences();
    return null;
  }

  function renderSync(preferences: UserPreferences | null) {
    apiMock.mockResolvedValue(
      { preferences: preferences ?? {} } as never,
    );
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(SyncHarness),
      ),
    );
  }

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    __resetThemeSyncForTests();
    apiMock.mockReset();
    window.localStorage.clear();
    document.documentElement.className = '';
    useTheme.setState({ themeMode: 'auto', accentColor: 'auto' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('seeds the theme store from the first response carrying theme keys', async () => {
    renderSync({ themeMode: 'dark', accentColor: 'purple' });

    await waitFor(() => {
      expect(useTheme.getState().themeMode).toBe('dark');
      expect(useTheme.getState().accentColor).toBe('purple');
    });
    // The seed re-applies, refreshing the cold-boot snapshot for next time.
    expect(JSON.parse(window.localStorage.getItem('sonarly-theme')!)).toEqual({
      mode: 'dark',
      accent: 'purple',
    });
    expect(document.documentElement.className).toContain('theme-dark');
    expect(document.documentElement.className).toContain('accent-purple');
  });

  it('leaves the local snapshot alone when the server has no theme keys (fresh account)', async () => {
    renderSync(null); // defaults only: autoDj keys, no themeMode/accentColor

    await waitFor(() => {
      expect(queryClient.getQueryData(['me', 'preferences'])).toBeDefined();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useTheme.getState().themeMode).toBe('auto');
    expect(useTheme.getState().accentColor).toBe('auto');
  });

  it('seeds only once: later resolutions never overwrite the seeded values', async () => {
    renderSync({ themeMode: 'dark', accentColor: 'purple' });
    await waitFor(() => {
      expect(useTheme.getState().accentColor).toBe('purple');
    });
    cleanup();

    // A later fetch (another device changed prefs) must not re-theme —
    // after the boot seed only PATCH responses write.
    apiMock.mockResolvedValue({ preferences: { themeMode: 'light', accentColor: 'brown' } } as never);
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(SyncHarness),
      ),
    );

    await waitFor(() => {
      expect(queryClient.getQueryData(['me', 'preferences'])).toEqual({
        preferences: { themeMode: 'light', accentColor: 'brown' },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useTheme.getState().themeMode).toBe('dark');
    expect(useTheme.getState().accentColor).toBe('purple');
  });

  it('yields to a mutation that already wrote: the boot seed cannot clobber it', async () => {
    // The user PATCHes before the boot GET resolves (response disagrees with
    // the request, proving the store follows the server response).
    apiMock.mockResolvedValue({ preferences: serverPreferences } as never);
    let mutate: (body: Partial<UserPreferences>) => void = () => {};
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(Harness, { trigger: (m) => { mutate = m; } }),
      ),
    );
    mutate({ themeMode: 'dark' });
    await waitFor(() => {
      expect(useTheme.getState().themeMode).toBe('oled');
    });
    cleanup();

    // The late boot seed sees different preferences and must not overwrite.
    renderSync({ themeMode: 'light', accentColor: 'brown' });
    await waitFor(() => {
      expect(queryClient.getQueryData(['me', 'preferences'])).toEqual({
        preferences: { themeMode: 'light', accentColor: 'brown' },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useTheme.getState().themeMode).toBe('oled');
    expect(useTheme.getState().accentColor).toBe('purple');
  });
});
