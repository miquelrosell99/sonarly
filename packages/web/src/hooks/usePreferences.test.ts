import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserPreferences } from '../types';
import { useUpdatePreferences } from './usePreferences.js';
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
