import type { ReactNode } from 'react';
import type { ViewMode } from '../../hooks/usePersistentViewMode.js';

export interface LibraryViewColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface LibraryViewCardField<T> {
  key: string;
  label?: ReactNode;
  render: (item: T) => ReactNode;
  getHref?: (item: T) => string | undefined;
}

export interface LibraryViewProps<T> {
  title?: string;
  data: T[];
  isLoading?: boolean;
  error?: string | Error | null;
  columns: LibraryViewColumn<T>[];
  cardFields: LibraryViewCardField<T>[];
  getId: (item: T) => string;
  getHref: (item: T) => string;
  onPlay?: (item: T) => void;
  onPlaySelection?: (items: T[], startIndex: number) => void;
  onShufflePlay?: (data: T[]) => void;
  /** When true, the header shuffle button is still shown but individual row/card play buttons will not support hold-to-shuffle. */
  disableRowShuffle?: boolean;
  onFavorite?: (item: T, starred: boolean) => void;
  onRate?: (item: T, rating?: number) => void;
  getFavorite?: (item: T) => boolean | undefined;
  getRating?: (item: T) => number | undefined;
  renderContextMenu?: (item: T, children: ReactNode, selectedItems: T[]) => ReactNode;
  emptyMessage?: string;
  /** Extra explanation line under the empty message (e.g. an upload pointer). */
  emptyDescription?: string;
  /** Primary action for the empty state, when one exists (e.g. "Clear filters"). */
  emptyAction?: { label: string; onClick: () => void };
  /** Retry affordance for the error state; the server message stays inline. */
  onRetry?: () => void;
  defaultView?: 'list' | 'grid';
  availableViews?: ViewMode[];
  /**
   * Stable per-page key ('tracks', 'albums', 'search-songs', …) persisting
   * the user's list/grid choice in localStorage so it survives navigation
   * and reloads (audit F28). Omit for ephemeral views (queue editor).
   */
  viewModeKey?: string;
  /**
   * Stable per-view key ('songs', 'artist-tracks', …) for the column
   * configurator: a gear in the list toolbar opens a popover with show/hide
   * toggles and reorder controls, persisted per view (see useColumnConfig).
   * Views that reuse the same column definitions share one key so the
   * configuration follows the user across pages. Omit for fixed layouts.
   */
  columnConfigKey?: string;
  getCover?: (item: T) => string | undefined;
  getCoverAlt?: (item: T) => string;
  renderCover?: (item: T) => ReactNode;
  playingId?: string;
  sortable?: boolean;
  onReorder?: (items: T[]) => void;
  getRowClassName?: (item: T) => string;
  /** Override the displayed # label for a row. Returning undefined falls back to the 1-based row index. */
  getIndexLabel?: (item: T, index: number) => ReactNode;
  /** Group rows into sections by a shared key. Only contiguous rows with the same key are grouped together. */
  groupBy?: (item: T) => string | undefined;
  /** Render a custom header for a group. Receives the group key and the items in the group. */
  renderGroupHeader?: (key: string, items: T[]) => ReactNode;
  /**
   * Song-list opt-in for drag-and-drop: return the song ids a row drag
   * carries (usually the multi-selection when the row is part of it).
   * Enables dragging rows onto sidebar playlists. Omit for non-song views.
   */
  getDragSongIds?: (item: T, selectedItems: T[]) => string[] | undefined;
  /**
   * Lists longer than this are windowed (only visible rows/cards render).
   * dnd-sortable and grouped lists are never windowed. Defaults to 150.
   */
  virtualizeThreshold?: number;
}
