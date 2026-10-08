import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { SettingsAppearance } from './SettingsAppearance.js';
import { useTheme } from '../../../stores/themeStore.js';
import { useSettingsDraftStore } from '../stores/settingsDraftStore.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: vi.fn(),
}));

const apiMock = vi.mocked(api);

// jsdom has neither matchMedia nor WAAPI (Element.prototype.animate); the
// theme store queries the former on save, the toast animations need the
// latter (same stubs as themeStore.test / NotificationContext.test).
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  Element.prototype.animate = vi.fn().mockReturnValue({
    cancel: vi.fn(),
    play: vi.fn(),
    set onfinish(_handler: (() => void) | null) {
      // Never fires in tests.
    },
  }) as unknown as typeof Element.prototype.animate;
});

describe('SettingsAppearance', () => {
  let queryClient: QueryClient;

  function renderPage() {
    return render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          NotificationProvider,
          null,
          React.createElement(SettingsAppearance),
        ),
      ),
    );
  }

  /** Server preferences returned by the GET, and the PATCH response. */
  function mockPreferences(preferences: Record<string, unknown>, patchResponse?: Record<string, unknown>) {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/me/preferences' && init?.method === 'PATCH') {
        return { preferences: patchResponse ?? preferences } as never;
      }
      if (path === '/me/preferences') {
        return { preferences } as never;
      }
      return {} as never;
    });
  }

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.localStorage.clear();
    useTheme.setState({ themeMode: 'auto', accentColor: 'auto' });
    useSettingsDraftStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSettingsDraftStore.getState().clear();
  });

  it('defaults to Auto theme / Copper accent when nothing is stored', async () => {
    mockPreferences({});
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Auto' }).className).toContain(
        'border-accent bg-surface-hover',
      );
    });
    expect(screen.getByRole('button', { name: 'Accent color: Copper' })).toBeTruthy();
  });

  it('renders the stored selection from server preferences', async () => {
    mockPreferences({ themeMode: 'dark', accentColor: 'purple' });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    });
    expect(screen.getByRole('button', { name: 'Accent color: Purple' })).toBeTruthy();
  });

  it('stages an accent change, shows the save bar, and PATCHes on save', async () => {
    mockPreferences({ accentColor: 'auto' }, { accentColor: 'purple' });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Accent color: Copper' })).toBeTruthy();
    });

    // Open the dropdown and pick Green.
    fireEvent.click(screen.getByRole('button', { name: 'Accent color: Copper' }));
    fireEvent.click(screen.getByRole('option', { name: 'Green' }));

    // Staged, not saved: no request yet, but the selection and the bar show.
    expect(apiMock).not.toHaveBeenCalledWith(
      '/me/preferences',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(screen.getByRole('button', { name: 'Accent color: Green' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ accentColor: 'green' }),
      });
    });
    // The server response is the single writer (FF8).
    await waitFor(() => {
      expect(useTheme.getState().accentColor).toBe('purple');
      expect(screen.getByRole('button', { name: 'Accent color: Purple' })).toBeTruthy();
    });
    // Saved: the bar is gone.
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('stages a theme-mode change and PATCHes it on save', async () => {
    mockPreferences({ themeMode: 'auto' }, { themeMode: 'oled' });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'OLED' }));
    expect(apiMock).not.toHaveBeenCalledWith(
      '/me/preferences',
      expect.objectContaining({ method: 'PATCH' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ themeMode: 'oled' }),
      });
      expect(useTheme.getState().themeMode).toBe('oled');
    });
  });

  it('clears the dirty state when a change is reverted, without a request', async () => {
    mockPreferences({ themeMode: 'auto' });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith(
      '/me/preferences',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('keeps the staged draft on a failed save so the user does not lose it', async () => {
    mockPreferences({ themeMode: 'auto' });
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/me/preferences' && init?.method === 'PATCH') {
        throw new Error('Server exploded');
      }
      return { preferences: { themeMode: 'auto' } } as never;
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText('Server exploded')).toBeTruthy();
    });
    // Draft intact: the bar is still there and the selection still staged.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
  });
});
