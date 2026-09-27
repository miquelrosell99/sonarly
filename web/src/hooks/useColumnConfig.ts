// Persistent per-view column configuration for list views (tracks, search
// songs, album/playlist entries, artist tracks). One storage key holds every
// view, same discipline as the view-mode store (audit F28): validated JSON,
// corrupt-safe reads, graceful degradation when storage is unavailable.
//
//   sonarly-columns → { "version": 1, "views": { "songs": { "order": [...], "hidden": [...] } } }
//
// `order` lists every available column key in display order (hidden columns
// keep their slot so re-showing them lands where the user left them); `hidden`
// lists the keys the user turned off. Locked keys (track title, row actions)
// may be reordered but are never hidden — hand-edited storage that lists a
// locked key in `hidden` is treated as corrupt-for-that-key and ignored.
import { useState } from 'react';

export const COLUMN_CONFIG_STORAGE_KEY = 'sonarly-columns';
export const COLUMN_CONFIG_VERSION = 1;

/** Pseudo-key for the non-data actions column (play/#/favorite/rating). */
export const ACTIONS_COLUMN_KEY = '__actions';

/** Columns that can be reordered but never hidden. */
export const DEFAULT_LOCKED_COLUMN_KEYS = ['title', ACTIONS_COLUMN_KEY];

export interface ColumnConfigColumn {
  key: string;
  label: string;
}

export interface ColumnConfigEntry {
  key: string;
  label: string;
  visible: boolean;
  locked: boolean;
}

interface StoredViewConfig {
  order: string[];
  hidden: string[];
}

interface StoredConfig {
  version?: number;
  views?: Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

// Read one view's config. Anything unrecognized — corrupt JSON, a version
// the client doesn't speak, non-array fields — yields undefined so the view
// falls back to its natural column set.
export function readStoredColumnConfig(viewKey: string): StoredViewConfig | undefined {
  try {
    const raw = window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredConfig;
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== COLUMN_CONFIG_VERSION) {
      return undefined;
    }
    const view = parsed.views?.[viewKey];
    if (view === null || typeof view !== 'object') return undefined;
    const { order, hidden } = view as Record<string, unknown>;
    return {
      order: isStringArray(order) ? order : [],
      hidden: isStringArray(hidden) ? hidden : [],
    };
  } catch {
    return undefined;
  }
}

function writeStoredColumnConfig(viewKey: string, config: StoredViewConfig): void {
  try {
    const raw = window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY);
    let views: Record<string, unknown> = {};
    if (raw) {
      const parsed = JSON.parse(raw) as StoredConfig;
      if (parsed !== null && typeof parsed === 'object' && parsed.version === COLUMN_CONFIG_VERSION) {
        if (parsed.views !== null && typeof parsed.views === 'object') views = { ...parsed.views };
      }
    }
    views[viewKey] = config;
    window.localStorage.setItem(
      COLUMN_CONFIG_STORAGE_KEY,
      JSON.stringify({ version: COLUMN_CONFIG_VERSION, views }),
    );
  } catch {
    // Storage unavailable (private mode, quota): the configurator still
    // works, it just doesn't persist — same graceful degradation as the
    // theme store.
  }
}

// Merge stored config with the columns the view currently offers: stored
// order first (unknown keys dropped), columns added since the config was
// written keep their natural position at the end, locked keys are never
// hidden even if storage says otherwise.
export function resolveColumnState(
  available: ColumnConfigColumn[],
  lockedKeys: string[],
  stored: StoredViewConfig | undefined,
): { order: string[]; hidden: string[] } {
  const availableKeys = available.map((column) => column.key);
  const storedOrder = (stored?.order ?? []).filter((key) => availableKeys.includes(key));
  const order = [...storedOrder, ...availableKeys.filter((key) => !storedOrder.includes(key))];
  const locked = new Set(lockedKeys);
  const hidden = [...new Set((stored?.hidden ?? []).filter((key) => availableKeys.includes(key) && !locked.has(key)))];
  return { order, hidden };
}

export interface ColumnConfig {
  /** Every data column in display order, including hidden ones. */
  entries: ColumnConfigEntry[];
  /** Keys of the columns to render, in display order. */
  visibleKeys: string[];
  toggle: (key: string) => void;
  move: (key: string, delta: -1 | 1) => void;
}

/** Map the resolved visible keys back onto the caller's column definitions. */
export function resolveColumns<T extends { key: string }>(columns: T[], visibleKeys: string[]): T[] {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  return visibleKeys
    .map((key) => byKey.get(key))
    .filter((column): column is T => column !== undefined);
}

export function useColumnConfig(
  configKey: string | undefined,
  available: ColumnConfigColumn[],
  lockedKeys: string[] = DEFAULT_LOCKED_COLUMN_KEYS,
): ColumnConfig {
  const [state, setState] = useState<{ key: string | undefined; config: StoredViewConfig | undefined }>(() => ({
    key: configKey,
    config: configKey ? readStoredColumnConfig(configKey) : undefined,
  }));

  // The view key is stable per mounted view, but adjust eagerly (render-time
  // derived-state reset) if a caller ever swaps it.
  if (state.key !== configKey) {
    setState({ key: configKey, config: configKey ? readStoredColumnConfig(configKey) : undefined });
  }

  const locked = new Set(lockedKeys);
  const resolved = resolveColumnState(available, lockedKeys, state.config);
  const hiddenSet = new Set(resolved.hidden);

  const toggle = (key: string) => {
    if (!configKey || locked.has(key) || !resolved.order.includes(key)) return;
    const hidden = hiddenSet.has(key)
      ? resolved.hidden.filter((entry) => entry !== key)
      : [...resolved.hidden, key];
    const next = { order: resolved.order, hidden };
    writeStoredColumnConfig(configKey, next);
    setState((prev) => ({ ...prev, config: next }));
  };

  const move = (key: string, delta: -1 | 1) => {
    if (!configKey) return;
    const index = resolved.order.indexOf(key);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= resolved.order.length) return;
    const order = [...resolved.order];
    [order[index], order[target]] = [order[target], order[index]];
    const next = { order, hidden: resolved.hidden };
    writeStoredColumnConfig(configKey, next);
    setState((prev) => ({ ...prev, config: next }));
  };

  return {
    entries: resolved.order.map((key) => ({
      key,
      label: available.find((column) => column.key === key)?.label ?? key,
      visible: !hiddenSet.has(key),
      locked: locked.has(key),
    })),
    visibleKeys: resolved.order.filter((key) => !hiddenSet.has(key)),
    toggle,
    move,
  };
}
