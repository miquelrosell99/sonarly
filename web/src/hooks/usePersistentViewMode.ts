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
import { useCallback, useState } from 'react';

export type ViewMode = 'list' | 'grid';

const STORAGE_KEY = 'sonarly-view-mode';

function readStoredMode(pageKey: string): ViewMode | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return undefined;
    const value = (parsed as Record<string, unknown>)[pageKey];
    return value === 'list' || value === 'grid' ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredMode(pageKey: string, mode: ViewMode): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const next = parsed !== null && typeof parsed === 'object' ? { ...(parsed as Record<string, unknown>) } : {};
    next[pageKey] = mode;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota): the toggle still works,
    // it just doesn't persist — same graceful degradation as the theme store.
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
    return stored !== undefined && availableViews.includes(stored) ? stored : effectiveDefault;
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
