import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { SettingsAppearance } from './SettingsAppearance.js';
import { useTheme } from '../../../stores/themeStore.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: vi.fn(),
}));

const apiMock = vi.mocked(api);

describe('SettingsAppearance', () => {
  let queryClient: QueryClient;

  function renderPage() {
    return render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(SettingsAppearance),
      ),
    );
  }

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.localStorage.clear();
    useTheme.setState({ themeMode: 'auto', accentColor: 'auto' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the stored (non-Auto) selection seeded on boot', () => {
    // Mirrors the boot product of useSyncThemePreferences resolving with
    // accentColor 'purple': the store is seeded and drives the selection.
    useTheme.getState().setThemeMode('dark');
    useTheme.getState().setAccentColor('purple');

    renderPage();

    const selectedSwatch = screen.getByRole('button', { name: 'Purple' });
    expect(selectedSwatch.className).toContain('ring-2 ring-fg-primary ring-offset-2');
    // The Auto swatch is not selected, even though it renders as monochrome.
    expect(screen.getByRole('button', { name: 'Auto (monochrome)' }).className).not.toContain(
      'ring-2 ring-fg-primary',
    );

    const darkButton = screen.getByRole('button', { name: 'Dark' });
    expect(darkButton.className).toContain('border-accent bg-surface-hover');
    expect(screen.getByRole('button', { name: 'Auto' }).className).not.toContain(
      'border-accent bg-surface-hover',
    );
  });

  it('PATCHes an accent change and applies the server response (FF8 single writer)', async () => {
    // The response deliberately disagrees with the request: the store must
    // follow the response.
    apiMock.mockResolvedValue({ preferences: { accentColor: 'purple' } } as never);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Green' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ accentColor: 'green' }),
      });
      expect(useTheme.getState().accentColor).toBe('purple');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Purple' }).className).toContain(
        'ring-2 ring-fg-primary ring-offset-2',
      );
    });
  });

  it('PATCHes a theme-mode change and selects it from the response', async () => {
    apiMock.mockResolvedValue({ preferences: { themeMode: 'oled' } } as never);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'OLED' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ themeMode: 'oled' }),
      });
      expect(useTheme.getState().themeMode).toBe('oled');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'OLED' }).className).toContain(
        'border-accent bg-surface-hover',
      );
    });
  });

  it('defaults to Auto / Auto (monochrome) when nothing is stored', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Auto' }).className).toContain(
      'border-accent bg-surface-hover',
    );
    expect(screen.getByRole('button', { name: 'Auto (monochrome)' }).className).toContain(
      'ring-2 ring-fg-primary ring-offset-2',
    );
  });
});
