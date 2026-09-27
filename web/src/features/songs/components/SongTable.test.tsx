import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SongTable, SONG_COLUMN_CONFIG_KEY } from './SongTable.js';
import { COLUMN_CONFIG_STORAGE_KEY } from '../../../hooks/useColumnConfig.js';

const songs = [
  { id: '1', title: 'Alpha', artistName: 'Artist A', albumName: 'Album A', duration: 180 },
  { id: '2', title: 'Beta', artistName: 'Artist B', albumName: 'Album B', duration: 240 },
];

function renderTable(props: Partial<React.ComponentProps<typeof SongTable>> = {}) {
  return render(<SongTable songs={songs} {...props} />);
}

function headerTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent ?? '');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('SongTable column configurator', () => {
  it('renders the standard columns and shares the songs config by default', () => {
    const { container } = renderTable();

    expect(headerTexts(container)).toEqual(['Title', 'Artist', 'Album', 'Duration']);
    expect(screen.getByRole('button', { name: 'Configure columns' })).toBeTruthy();

    // The shared key is what tracks/search/album/playlist views use too.
    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Artist column' }));

    const stored = JSON.parse(window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY)!);
    expect(Object.keys(stored.views)).toEqual([SONG_COLUMN_CONFIG_KEY]);
    expect(headerTexts(container)).toEqual(['Title', 'Album', 'Duration']);
  });

  it('honors a unique config key for consumers with their own column set', () => {
    const { container } = renderTable({ showAlbum: false, columnConfigKey: 'album-entries-test' });

    expect(headerTexts(container)).toEqual(['Title', 'Artist', 'Duration']);

    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Duration column' }));
    expect(headerTexts(container)).toEqual(['Title', 'Artist']);

    const stored = JSON.parse(window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY)!);
    expect(stored.views[SONG_COLUMN_CONFIG_KEY]).toBeUndefined();
    expect(stored.views['album-entries-test']).toBeTruthy();
  });

  it('reorders columns via the popover and the rows follow', () => {
    const { container } = renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Duration up' }));

    expect(headerTexts(container)).toEqual(['Title', 'Artist', 'Duration', 'Album']);
    // Row cells follow the same order: duration before album.
    const row = screen.getByText('Alpha').closest('tr')!;
    expect(row.textContent).toContain('3:00Album A');
  });
});
