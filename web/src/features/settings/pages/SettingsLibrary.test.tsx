import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import * as React from 'react';
import { SettingsLibrary } from './SettingsLibrary.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

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

describe('SettingsLibrary', () => {
  function renderPage() {
    return render(
      React.createElement(
        NotificationProvider,
        null,
        React.createElement(SettingsLibrary),
      ),
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('saves a default view per page to localStorage via the save bar', () => {
    renderPage();

    const yearsGroup = screen.getByRole('group', { name: 'Years default view' });
    fireEvent.click(within(yearsGroup).getByRole('button', { name: 'Grid' }));

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(window.localStorage.getItem('sonarly-view-mode-defaults')).toBe(
      JSON.stringify({ years: 'grid' }),
    );
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('restores saved defaults and discards staged changes', () => {
    window.localStorage.setItem('sonarly-view-mode-defaults', JSON.stringify({ albums: 'list' }));
    renderPage();

    const albumsGroup = screen.getByRole('group', { name: 'Albums default view' });
    expect(within(albumsGroup).getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(albumsGroup).getByRole('button', { name: 'Grid' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(within(albumsGroup).getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
    // Nothing was written.
    expect(window.localStorage.getItem('sonarly-view-mode-defaults')).toBe(
      JSON.stringify({ albums: 'list' }),
    );
  });
});
