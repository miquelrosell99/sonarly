// Persistent per-page view mode for LibraryView (audit F28: the grid/list
// toggle was local useState and reset on every mount). Callers pass a stable
// `pageKey` ('tracks', 'albums', 'search-songs', …); the chosen mode is
// remembered in localStorage under one JSON object so each page keeps its
// own preference across navigation and reloads:
//
//   sonarly-view-mode → { "tracks": "grid", "albums": "list", … }
//
// A stored value that the current page's `availableViews` doesn't offer
// falls back to the page's default — a list-only page can never inherit a
// grid mode it cannot render. Callers that pass no key keep ephemeral local
// state (queue editor, list-only pages).
//
// Resolution order for pages with a key: the user's explicit per-page choice
// (sonarly-view-mode) wins; otherwise the fleet default from
// `sonarly-view-mode-defaults` (edited on Settings → Library) applies;
// otherwise the page's built-in `defaultView` prop.
import { useCallback, useState } from 'react';

export type ViewMode = 'list' | 'grid';

const STORAGE_KEY = 'sonarly-view-mode';
export const DEFAULT_VIEW_MODES_STORAGE_KEY = 'sonarly-view-mode-defaults';

function parseModeMap(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readStoredMode(pageKey: string): ViewMode | undefined {
  const value = parseModeMap(window.localStorage.getItem(STORAGE_KEY))[pageKey];
  return value === 'list' || value === 'grid' ? value : undefined;
}

function writeStoredMode(pageKey: string, mode: ViewMode): void {
  try {
    const next = parseModeMap(window.localStorage.getItem(STORAGE_KEY));
    next[pageKey] = mode;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota): the toggle still works,
    // it just doesn't persist — same graceful degradation as the theme store.
  }
}

/** Fleet-wide default view per page key, as edited on Settings → Library. */
export function readDefaultViewModes(): Record<string, ViewMode> {
  const raw = parseModeMap(window.localStorage.getItem(DEFAULT_VIEW_MODES_STORAGE_KEY));
  const result: Record<string, ViewMode> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === 'list' || value === 'grid') result[key] = value;
  }
  return result;
}

export function writeDefaultViewModes(defaults: Record<string, ViewMode>): void {
  try {
    window.localStorage.setItem(DEFAULT_VIEW_MODES_STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // Same graceful degradation as writeStoredMode.
  }
}

export function usePersistentViewMode(
  pageKey: string | undefined,
  defaultView: ViewMode,
  availableViews: ViewMode[],
): [ViewMode, (mode: ViewMode) => void] {
  const effectiveDefault = availableViews.includes(defaultView) ? defaultView : availableViews[0];

  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (!pageKey) return effectiveDefault;
    const stored = readStoredMode(pageKey);
    if (stored !== undefined && availableViews.includes(stored)) return stored;
    const fleetDefault = readDefaultViewModes()[pageKey];
    return fleetDefault !== undefined && availableViews.includes(fleetDefault)
      ? fleetDefault
      : effectiveDefault;
  });

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      if (pageKey) writeStoredMode(pageKey, mode);
    },
    [pageKey],
  );

  return [viewMode, setViewMode];
}
