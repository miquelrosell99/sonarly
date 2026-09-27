import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useLibraryStore } from './libraryStore.js';

const STORAGE_KEY = 'sonarly-library';

function readPersisted(): { state?: Record<string, unknown> } | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { state?: Record<string, unknown> }) : null;
}

describe('libraryStore persistence (FF7)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLibraryStore.setState({ selectedLibraryId: null });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('persists selectedLibraryId to localStorage', () => {
    useLibraryStore.getState().setSelectedLibraryId('lib-1');
    const persisted = readPersisted();
    expect(persisted?.state?.selectedLibraryId).toBe('lib-1');
  });

  it('persists null when the selection is cleared', () => {
    useLibraryStore.getState().setSelectedLibraryId('lib-1');
    useLibraryStore.getState().setSelectedLibraryId(null);
    expect(readPersisted()?.state?.selectedLibraryId).toBe(null);
  });

  it('persists only the selection — the libraries list is server state (react-query)', () => {
    useLibraryStore.getState().setSelectedLibraryId('lib-1');
    const persisted = readPersisted();
    expect(Object.keys(persisted?.state ?? {})).toEqual(['selectedLibraryId']);
  });

  it('rehydrates the persisted selection (survives a reload)', async () => {
    // Simulate storage written by a previous session (any set() would
    // re-serialize current state, so seed after the reset in beforeEach).
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { selectedLibraryId: 'lib-2' }, version: 0 }),
    );

    await useLibraryStore.persist.rehydrate();
    expect(useLibraryStore.getState().selectedLibraryId).toBe('lib-2');
  });
});
