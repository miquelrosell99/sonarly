import { Fragment, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  onFavorite?: (item: T, starred: boolean) => void;
  onRate?: (item: T, rating?: number) => void;
  getFavorite?: (item: T) => boolean | undefined;
  getRating?: (item: T) => number | undefined;
  renderContextMenu?: (item: T, children: ReactNode, selectedItems: T[]) => ReactNode;
  emptyMessage?: string;
  defaultView?: 'list' | 'grid';
  availableViews?: ViewMode[];
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
}

type ViewMode = 'list' | 'grid';

function SortableLibraryRow<T>({
  item,
  getId,
  index,
  columns,
  isSelected,
  isPlaying,
  onSelect,
  onActivate,
  onPlay,
  onShufflePlay,
  favorite,
  rating,
  renderContextMenu,
  rowClassName,
  indexPad,
  indexLabel,
  selectedItems,
}: {
  item: T;
  getId: (item: T) => string;
  index: number;
  columns: LibraryViewColumn<T>[];
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: (e: MouseEvent) => void;
  onActivate: () => void;
  onPlay?: () => void;
  onShufflePlay?: () => void;
  favorite?: { starred?: boolean; onClick: () => void };
  rating?: { value?: number; onRate: (value: number) => void };
  renderContextMenu?: (children: ReactNode, selectedItems: T[]) => ReactNode;
  rowClassName?: string;
  indexPad?: number;
  indexLabel?: ReactNode;
  selectedItems?: T[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: getId(item) });

  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : transform),
    transition,
  };

  const row = (
    <ListRow
      index={index}
      isSelected={isSelected}
      isPlaying={isPlaying}
      onSelect={onSelect}
      onActivate={onActivate}
      onPlay={onPlay}
      onShufflePlay={onShufflePlay}
      favorite={favorite}
      rating={rating}
      sortable
      sortableRef={setNodeRef}
      sortableStyle={style}
      isDragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
      className={rowClassName}
      indexPad={indexPad}
      indexLabel={indexLabel}
    >
      {columns.map((col) => (
        <td key={col.key} className={cn('truncate py-2 pr-4', col.className)}>
          {col.render(item)}
        </td>
      ))}
    </ListRow>
  );

  return renderContextMenu ? renderContextMenu(row, selectedItems ?? []) : row;
}

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
  sortable = false,
  onReorder,
  getRowClassName,
  getIndexLabel,
  groupBy,
  renderGroupHeader,
}: LibraryViewProps<T>) {
  const effectiveDefaultView = availableViews.includes(defaultView) ? defaultView : availableViews[0];
  const [viewMode, setViewMode] = useState<ViewMode>(effectiveDefaultView);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const errorText = error instanceof Error ? error.message : error ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  const handleDragEnd = (event: DragEndEvent) => {
    if (!onReorder) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = data.findIndex((item) => getId(item) === active.id);
    const newIndex = data.findIndex((item) => getId(item) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = [...data];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    onReorder(next);
  };

  if (isLoading) {
    return (
      <div>
        {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  if (errorText) {
    return (
      <div>
        {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
        <p className="text-sm text-danger">{errorText}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
        <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>
      </div>
    );
  }

  const renderList = () => {
    const indexPad = Math.max(2, String(data.length).length);

    const rowIndexMap = new Map<T, number>();
    data.forEach((item, idx) => rowIndexMap.set(item, idx));

    const selectedItems = data.filter((d) => selectedIds.has(getId(d)));

    const groups: { key?: string; items: T[] }[] = [];
    if (!groupBy) {
      groups.push({ items: data });
    } else {
      for (const item of data) {
        const key = groupBy(item);
        const last = groups[groups.length - 1];
        if (!last || last.key !== key) {
          groups.push({ key, items: [] });
        }
        groups[groups.length - 1].items.push(item);
      }
    }

    const groupHeaderColSpan =
      (sortable ? 1 : 0) + 1 + columns.length + (onFavorite ? 1 : 0) + (onRate ? 1 : 0);

    const table = (
      <table className="w-full text-left text-sm">
        <thead className="border-b border-rule text-muted">
          <tr>
            {sortable && <th className="w-8 py-2 pr-2 font-medium" aria-label="Reorder" />}
            <th className="w-12 py-2 px-2 text-center font-medium">#</th>
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
          {groups.map((group, groupIndex) => (
            <Fragment key={group.key ?? `group-${groupIndex}`}>
              {group.key !== undefined && group.key !== '' && (
                <tr className="border-t border-rule first:border-t-0">
                  <th
                    colSpan={groupHeaderColSpan}
                    className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-muted"
                    scope="rowgroup"
                  >
                    {renderGroupHeader ? renderGroupHeader(group.key, group.items) : group.key}
                  </th>
                </tr>
              )}
              {group.items.map((item) => {
                const index = rowIndexMap.get(item) ?? 0;
                const id = getId(item);
                const href = getHref(item);
                const starred = getFavorite?.(item);
                const rating = getRating?.(item);
                const isSelected = selectedIds.has(id);
                const isPlaying = playingId !== undefined && playingId === id;
                const indexLabel = getIndexLabel?.(item, index);

                if (sortable) {
                  return (
                    <SortableLibraryRow
                      key={id}
                      item={item}
                      getId={getId}
                      index={index}
                      columns={columns}
                      isSelected={isSelected}
                      isPlaying={isPlaying}
                      onSelect={(e) => handleRowSelect(item, e)}
                      onActivate={() => handleRowActivate(item)}
                      onPlay={onPlay ? () => onPlay(item) : undefined}
                      onShufflePlay={onShufflePlay ? () => onShufflePlay(data) : undefined}
                      favorite={onFavorite ? { starred, onClick: () => onFavorite(item, !starred) } : undefined}
                      rating={onRate ? { value: rating, onRate: (value) => onRate(item, value || undefined) } : undefined}
                      renderContextMenu={
                        renderContextMenu
                          ? (children, selectedItems) => {
                              const menuSelection = selectedItems.length > 0 ? selectedItems : [item];
                              return renderContextMenu(item, children, menuSelection);
                            }
                          : undefined
                      }
                      selectedItems={selectedItems}
                      rowClassName={getRowClassName?.(item)}
                      indexPad={indexPad}
                      indexLabel={indexLabel}
                    />
                  );
                }

                const row = (
                  <ListRow
                    href={href}
                    index={index}
                    isSelected={isSelected}
                    isPlaying={isPlaying}
                    onSelect={(e) => handleRowSelect(item, e)}
                    onActivate={() => handleRowActivate(item)}
                    onPlay={onPlay ? () => onPlay(item) : undefined}
                    onShufflePlay={onShufflePlay ? () => onShufflePlay(data) : undefined}
                    favorite={onFavorite ? { starred, onClick: () => onFavorite(item, !starred) } : undefined}
                    rating={onRate ? { value: rating, onRate: (value) => onRate(item, value || undefined) } : undefined}
                    className={getRowClassName?.(item)}
                    indexPad={indexPad}
                    indexLabel={indexLabel}
                  >
                    {columns.map((col) => (
                      <td key={col.key} className={cn('truncate py-2 pr-4', col.className)}>
                        {col.render(item)}
                      </td>
                    ))}
                  </ListRow>
                );
                const menuSelection = selectedItems.length > 0 ? selectedItems : [item];
                return (
                  <Fragment key={id}>
                    {renderContextMenu ? renderContextMenu(item, row, menuSelection) : row}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    );

    return (
      <div className="overflow-x-auto" onKeyDown={handleContainerKeyDown} role="grid" aria-multiselectable="true">
        {sortable ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={data.map((item) => getId(item))} strategy={verticalListSortingStrategy}>
              {table}
            </SortableContext>
          </DndContext>
        ) : (
          table
        )}
      </div>
    );
  };

  const renderGrid = () => (
    <div className="library-view-grid grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {data.map((item) => {
        const href = getHref(item);
        const starred = getFavorite?.(item);
        const rating = getRating?.(item);
        const coverId = getCover?.(item);
        const customCover = renderCover?.(item);
        const isPlaying = playingId !== undefined && playingId === getId(item);
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
            play={onPlay ? { onPlay: () => onPlay(item), onShufflePlay: onShufflePlay ? () => onShufflePlay(data) : undefined } : undefined}
            isPlaying={isPlaying}
          />
        );
        return (
          <Fragment key={getId(item)}>
            {renderContextMenu ? renderContextMenu(item, card, [item]) : card}
          </Fragment>
        );
      })}
    </div>
  );

  return (
    <div>
      {title && (
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
      )}
      {viewMode === 'list' ? renderList() : renderGrid()}
    </div>
  );
}
