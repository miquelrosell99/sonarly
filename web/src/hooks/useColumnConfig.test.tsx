import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useColumnConfig,
  resolveColumns,
  readStoredColumnConfig,
  COLUMN_CONFIG_STORAGE_KEY,
} from './useColumnConfig.js';

const AVAILABLE = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'duration', label: 'Duration' },
];

const naturalKeys = AVAILABLE.map((column) => column.key);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('useColumnConfig', () => {
  it('defaults to the natural order with every column visible', () => {
    const { result } = renderHook(() => useColumnConfig('songs', AVAILABLE));

    expect(result.current.visibleKeys).toEqual(naturalKeys);
    expect(result.current.entries.map((entry) => entry.visible)).toEqual([true, true, true, true]);
    expect(result.current.entries.map((entry) => entry.label)).toEqual(['Title', 'Artist', 'Album', 'Duration']);
  });

  it('hides a column and persists the config across hook instances (round-trip)', () => {
    const first = renderHook(() => useColumnConfig('songs', AVAILABLE));
    act(() => first.result.current.toggle('duration'));
    expect(first.result.current.visibleKeys).toEqual(['title', 'artist', 'album']);
    first.unmount();

    const stored = JSON.parse(window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY)!);
    expect(stored.version).toBe(1);
    expect(stored.views.songs).toEqual({ order: naturalKeys, hidden: ['duration'] });

    const second = renderHook(() => useColumnConfig('songs', AVAILABLE));
    expect(second.result.current.visibleKeys).toEqual(['title', 'artist', 'album']);
  });

  it('never hides locked columns, even from hand-edited storage', () => {
    const first = renderHook(() => useColumnConfig('songs', AVAILABLE));
    act(() => first.result.current.toggle('title'));
    // Locked toggle is a no-op: nothing persisted, nothing hidden.
    expect(first.result.current.visibleKeys).toEqual(naturalKeys);
    expect(window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY)).toBeNull();
    first.unmount();

    // Poisoned storage: title listed as hidden anyway.
    window.localStorage.setItem(
      COLUMN_CONFIG_STORAGE_KEY,
      JSON.stringify({ version: 1, views: { songs: { order: naturalKeys, hidden: ['title', 'duration'] } } }),
    );
    const second = renderHook(() => useColumnConfig('songs', AVAILABLE));
    expect(second.result.current.visibleKeys).toEqual(['title', 'artist', 'album']);
  });

  it('reorders columns, persists the order, and keeps hidden columns hidden', () => {
    const first = renderHook(() => useColumnConfig('songs', AVAILABLE));
    act(() => first.result.current.toggle('album'));
    act(() => first.result.current.move('duration', -1));
    expect(first.result.current.visibleKeys).toEqual(['title', 'artist', 'duration']);
    first.unmount();

    const stored = JSON.parse(window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY)!);
    expect(stored.views.songs.order).toEqual(['title', 'artist', 'duration', 'album']);
    expect(stored.views.songs.hidden).toEqual(['album']);

    const second = renderHook(() => useColumnConfig('songs', AVAILABLE));
    expect(second.result.current.visibleKeys).toEqual(['title', 'artist', 'duration']);
  });

  it('lets locked columns reorder but clamps moves at the edges', () => {
    const { result } = renderHook(() => useColumnConfig('songs', AVAILABLE));

    act(() => result.current.move('title', 1));
    expect(result.current.visibleKeys).toEqual(['artist', 'title', 'album', 'duration']);

    act(() => result.current.move('title', -1));
    act(() => result.current.move('title', -1)); // already first: clamped
    expect(result.current.visibleKeys).toEqual(naturalKeys);

    act(() => result.current.move('duration', 1)); // already last: clamped
    expect(result.current.visibleKeys).toEqual(naturalKeys);
  });

  it('keeps per-view configs isolated under one storage key', () => {
    const songs = renderHook(() => useColumnConfig('songs', AVAILABLE));
    const artistTracks = renderHook(() =>
      useColumnConfig('artist-tracks', [
        { key: 'title', label: 'Title' },
        { key: 'album', label: 'Album' },
        { key: 'duration', label: 'Duration' },
      ]),
    );

    act(() => songs.result.current.toggle('artist'));
    act(() => artistTracks.result.current.move('duration', -1));

    expect(songs.result.current.visibleKeys).toEqual(['title', 'album', 'duration']);
    expect(artistTracks.result.current.visibleKeys).toEqual(['title', 'duration', 'album']);

    const stored = JSON.parse(window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY)!);
    expect(Object.keys(stored.views).sort()).toEqual(['artist-tracks', 'songs']);
  });

  it('falls back to defaults on corrupt or version-mismatched storage', () => {
    window.localStorage.setItem(COLUMN_CONFIG_STORAGE_KEY, 'not-json{');
    const corrupt = renderHook(() => useColumnConfig('songs', AVAILABLE));
    expect(corrupt.result.current.visibleKeys).toEqual(naturalKeys);
    corrupt.unmount();

    window.localStorage.setItem(
      COLUMN_CONFIG_STORAGE_KEY,
      JSON.stringify({ version: 99, views: { songs: { order: ['duration'], hidden: ['title'] } } }),
    );
    const future = renderHook(() => useColumnConfig('songs', AVAILABLE));
    expect(future.result.current.visibleKeys).toEqual(naturalKeys);
  });

  it('drops unknown stored keys and appends new columns in their natural position', () => {
    window.localStorage.setItem(
      COLUMN_CONFIG_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        views: { songs: { order: ['duration', 'bogus', 'title'], hidden: ['bogus', 'artist'] } },
      }),
    );
    const { result } = renderHook(() => useColumnConfig('songs', AVAILABLE));

    expect(result.current.visibleKeys).toEqual(['duration', 'title', 'album']);
    expect(result.current.entries.map((entry) => entry.key)).toEqual(['duration', 'title', 'artist', 'album']);
  });

  it('does nothing when no config key is provided', () => {
    const { result } = renderHook(() => useColumnConfig(undefined, AVAILABLE));
    act(() => result.current.toggle('duration'));
    act(() => result.current.move('duration', -1));
    expect(result.current.visibleKeys).toEqual(naturalKeys);
    expect(window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY)).toBeNull();
  });
});

describe('resolveColumns', () => {
  it('maps visible keys back onto the caller column definitions in order', () => {
    const columns = [
      { key: 'title', render: () => 't' },
      { key: 'artist', render: () => 'a' },
      { key: 'duration', render: () => 'd' },
    ];
    expect(resolveColumns(columns, ['duration', 'title']).map((column) => column.key)).toEqual(['duration', 'title']);
  });
});

describe('readStoredColumnConfig', () => {
  it('returns undefined for missing or malformed views', () => {
    expect(readStoredColumnConfig('songs')).toBeUndefined();
    window.localStorage.setItem(COLUMN_CONFIG_STORAGE_KEY, JSON.stringify({ version: 1, views: { songs: { order: 'nope' } } }));
    expect(readStoredColumnConfig('songs')).toEqual({ order: [], hidden: [] });
    expect(readStoredColumnConfig('other')).toBeUndefined();
  });
});
