import { Fragment, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { Card } from './Card.js';
import { CoverArt } from './CoverArt.js';
import { ListRow } from './ListRow.js';

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

interface LibraryViewProps<T> {
  title: string;
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
  onFavorite?: (item: T, starred: boolean) => void;
  onRate?: (item: T, rating?: number) => void;
  getFavorite?: (item: T) => boolean | undefined;
  getRating?: (item: T) => number | undefined;
  renderContextMenu?: (item: T, children: ReactNode) => ReactNode;
  emptyMessage?: string;
  defaultView?: 'list' | 'grid';
  availableViews?: ViewMode[];
  getCover?: (item: T) => string | undefined;
  getCoverAlt?: (item: T) => string;
  renderCover?: (item: T) => ReactNode;
  playingId?: string;
}

type ViewMode = 'list' | 'grid';

export function LibraryView<T>({
  title,
  data,
  isLoading,
  error,
  columns,
  cardFields,
  getId,
  getHref,
  onPlay,
  onPlaySelection,
  onShufflePlay,
  onFavorite,
  onRate,
  getFavorite,
  getRating,
  renderContextMenu,
  emptyMessage = 'No items found.',
  defaultView = 'list',
  availableViews = ['list', 'grid'],
  getCover,
  getCoverAlt,
  renderCover,
  playingId,
}: LibraryViewProps<T>) {
  const effectiveDefaultView = availableViews.includes(defaultView) ? defaultView : availableViews[0];
  const [viewMode, setViewMode] = useState<ViewMode>(effectiveDefaultView);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const errorText = error instanceof Error ? error.message : error ?? null;

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  };

  const selectOnly = (id: string) => {
    setSelectedIds(new Set([id]));
    setLastSelectedId(id);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  };

  const selectRange = (fromId: string, toId: string) => {
    const fromIndex = data.findIndex((item) => getId(item) === fromId);
    const toIndex = data.findIndex((item) => getId(item) === toId);
    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const next = new Set<string>();
    for (let i = start; i <= end; i++) {
      next.add(getId(data[i]));
    }
    setSelectedIds(next);
    setLastSelectedId(toId);
  };

  const handleRowSelect = (item: T, e: MouseEvent) => {
    const id = getId(item);
    if (e.shiftKey && lastSelectedId) {
      selectRange(lastSelectedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelection(id);
    } else {
      selectOnly(id);
    }
  };

  const handleRowActivate = (item: T) => {
    if (!onPlaySelection) return;
    const id = getId(item);
    const selected = selectedIds.size > 0 ? data.filter((d) => selectedIds.has(getId(d))) : [item];
    const startIndex = selected.findIndex((d) => getId(d) === id);
    const safeStart = startIndex === -1 ? 0 : startIndex;
    onPlaySelection(selected, safeStart);
  };

  const handleContainerKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      clearSelection();
    }
  };

  if (isLoading) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  if (errorText) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-danger">{errorText}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>
      </div>
    );
  }

  const renderList = () => (
    <div className="overflow-x-auto" onKeyDown={handleContainerKeyDown} role="grid" aria-multiselectable="true">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-rule text-muted">
          <tr>
            <th className="w-12 py-2 pr-4 font-medium">#</th>
            {columns.map((col) => (
              <th key={col.key} className={cn('py-2 pr-4 font-medium', col.className)}>
                {col.header}
              </th>
            ))}
            {onFavorite && <th className="w-10 py-2 pr-4 font-medium" aria-label="Favorite" />}
            {onRate && <th className="w-32 py-2 pr-4 font-medium" aria-label="Rating" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {data.map((item, index) => {
            const id = getId(item);
            const href = getHref(item);
            const starred = getFavorite?.(item);
            const rating = getRating?.(item);
            const isSelected = selectedIds.has(id);
            const isPlayingTitle = playingId !== undefined && playingId === id;
            const row = (
              <ListRow
                href={href}
                index={index}
                isSelected={isSelected}
                isPlayingTitle={isPlayingTitle}
                onSelect={(e) => handleRowSelect(item, e)}
                onActivate={() => handleRowActivate(item)}
                onPlay={onPlay ? () => onPlay(item) : undefined}
                onShufflePlay={onShufflePlay ? () => onShufflePlay(data) : undefined}
                favorite={onFavorite ? { starred, onClick: () => onFavorite(item, !starred) } : undefined}
                rating={onRate ? { value: rating, onRate: (value) => onRate(item, value || undefined) } : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('py-2 pr-4', col.className)}>
                    {col.render(item)}
                  </td>
                ))}
              </ListRow>
            );
            return (
              <Fragment key={id}>
                {renderContextMenu ? renderContextMenu(item, row) : row}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderGrid = () => (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {data.map((item) => {
        const href = getHref(item);
        const starred = getFavorite?.(item);
        const rating = getRating?.(item);
        const coverId = getCover?.(item);
        const customCover = renderCover?.(item);
        const [titleField, ...extraFields] = cardFields;
        const coverElement =
          customCover ??
          (coverId !== undefined ? (
            <CoverArt coverArt={coverId} alt={getCoverAlt?.(item) ?? 'Cover art'} />
          ) : undefined);
        const card = (
          <Card
            href={href}
            title={titleField.render(item)}
            fields={extraFields.map((field) => ({
              content: field.render(item),
              href: field.getHref?.(item),
            }))}
            cover={coverElement}
            favorite={onFavorite ? { starred, onClick: () => onFavorite(item, !starred) } : undefined}
            rating={onRate ? { value: rating, onRate: (value) => onRate(item, value || undefined) } : undefined}
            play={onPlay ? { onPlay: () => onPlay(item), onShufflePlay: onShufflePlay ? () => onShufflePlay(data) : () => {} } : undefined}
          />
        );
        return (
          <Fragment key={getId(item)}>
            {renderContextMenu ? renderContextMenu(item, card) : card}
          </Fragment>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {onShufflePlay && (
            <button
              type="button"
              aria-label="Shuffle play"
              onClick={() => onShufflePlay(data)}
              disabled={data.length === 0}
              className="inline-flex items-center rounded-md border border-rule bg-surface p-2 text-fg-primary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <Icon name="mdi-shuffle" size={20} />
            </button>
          )}
          {availableViews.length > 1 && (
            <div className="flex items-center rounded-md border border-rule bg-surface p-1">
              {availableViews.includes('list') && (
                <button
                  type="button"
                  aria-label="List view"
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'rounded p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    viewMode === 'list' ? 'bg-surface-hover text-accent' : 'text-muted hover:text-fg-primary',
                  )}
                >
                  <Icon name="mdi-format-list-bulleted" size={20} />
                </button>
              )}
              {availableViews.includes('grid') && (
                <button
                  type="button"
                  aria-label="Grid view"
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'rounded p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    viewMode === 'grid' ? 'bg-surface-hover text-accent' : 'text-muted hover:text-fg-primary',
                  )}
                >
                  <Icon name="mdi-view-grid-outline" size={20} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {viewMode === 'list' ? renderList() : renderGrid()}
    </div>
  );
}
