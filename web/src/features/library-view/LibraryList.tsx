import { Fragment, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '../../lib/cn.js';
import { ListRow } from '../../components/ListRow.js';
import { startSongsDrag } from '../../lib/dragSongs.js';
import { VirtualList } from '../../components/ui/VirtualList.js';
import { SortableLibraryRow } from './SortableLibraryRow.js';
import type { LibrarySelection } from './useLibrarySelection.js';
import type { LibraryViewColumn } from './types.js';

export interface LibraryListProps<T> {
  data: T[];
  getId: (item: T) => string;
  getHref: (item: T) => string;
  columns: LibraryViewColumn<T>[];
  onPlay?: (item: T) => void;
  onShufflePlay?: (data: T[]) => void;
  disableRowShuffle?: boolean;
  onFavorite?: (item: T, starred: boolean) => void;
  onRate?: (item: T, rating?: number) => void;
  getFavorite?: (item: T) => boolean | undefined;
  getRating?: (item: T) => number | undefined;
  renderContextMenu?: (item: T, children: ReactNode, selectedItems: T[]) => ReactNode;
  getRowClassName?: (item: T) => string;
  getIndexLabel?: (item: T, index: number) => ReactNode;
  groupBy?: (item: T) => string | undefined;
  renderGroupHeader?: (key: string, items: T[]) => ReactNode;
  getDragSongIds?: (item: T, selectedItems: T[]) => string[] | undefined;
  playingId?: string;
  sortable?: boolean;
  onReorder?: (items: T[]) => void;
  scrollParent: HTMLElement | null;
  virtualizeThreshold: number;
  selection: LibrarySelection<T>;
}

export function LibraryList<T>({
  data,
  getId,
  getHref,
  columns,
  onPlay,
  onShufflePlay,
  disableRowShuffle,
  onFavorite,
  onRate,
  getFavorite,
  getRating,
  renderContextMenu,
  getRowClassName,
  getIndexLabel,
  groupBy,
  renderGroupHeader,
  getDragSongIds,
  playingId,
  sortable = false,
  onReorder,
  scrollParent,
  virtualizeThreshold,
  selection,
}: LibraryListProps<T>) {
  const { selectable, selectedIds, handleRowSelect, handleRowActivate, handleContainerKeyDown } = selection;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  const indexPad = Math.max(2, String(data.length).length);

  const rowIndexMap = new Map<T, number>();
  data.forEach((item, idx) => rowIndexMap.set(item, idx));

  const selectedItems = selectable ? data.filter((d) => selectedIds.has(getId(d))) : [];

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

  // The dnd-sortable list (queue editor) and grouped lists keep the
  // unwindowed renderer: dnd and group headers do not survive windowing.
  // Large plain lists window unconditionally — VirtualList renders a
  // cheap fixed window until the scroll parent resolves (first commit),
  // so this must not depend on scrollParent being non-null: gating on it
  // rendered every row on section opens (seconds-long stalls, see
  // VirtualList's FALLBACK_ROWS note).
  const useVirtualRows =
    !sortable && !groupBy && data.length > virtualizeThreshold;

  const renderItemRow = (item: T) => {
    const index = rowIndexMap.get(item) ?? 0;
    const id = getId(item);
    const href = getHref(item);
    const starred = getFavorite?.(item);
    const rating = getRating?.(item);
    const isSelected = selectable && selectedIds.has(id);
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
          onShufflePlay={onShufflePlay && !disableRowShuffle ? () => onShufflePlay(data) : undefined}
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

    const menuSelection = selectedItems.length > 0 ? selectedItems : [item];
    const dragIds = getDragSongIds?.(item, menuSelection);
    const row = (
      <ListRow
        href={href}
        index={index}
        isSelected={isSelected}
        isPlaying={isPlaying}
        onSelect={(e) => handleRowSelect(item, e)}
        onActivate={() => handleRowActivate(item)}
        onPlay={onPlay ? () => onPlay(item) : undefined}
        onShufflePlay={onShufflePlay && !disableRowShuffle ? () => onShufflePlay(data) : undefined}
        favorite={onFavorite ? { starred, onClick: () => onFavorite(item, !starred) } : undefined}
        rating={onRate ? { value: rating, onRate: (value) => onRate(item, value || undefined) } : undefined}
        draggable={dragIds !== undefined && dragIds.length > 0}
        onDragStart={dragIds && dragIds.length > 0 ? (e) => startSongsDrag(e, dragIds) : undefined}
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
    return renderContextMenu ? renderContextMenu(item, row, menuSelection) : row;
  };

  const table = (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-outline text-on-surface-variant">
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
      {useVirtualRows ? (
        <VirtualList
          items={data}
          getId={getId}
          scrollElement={scrollParent}
          spacerColSpan={groupHeaderColSpan}
          renderItem={renderItemRow}
        />
      ) : (
        <tbody className="divide-y divide-outline">
          {groups.map((group, groupIndex) => (
            <Fragment key={group.key ?? `group-${groupIndex}`}>
              {group.key !== undefined && group.key !== '' && (
                <tr className="border-t border-outline first:border-t-0">
                  <th
                    colSpan={groupHeaderColSpan}
                    className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
                    scope="rowgroup"
                  >
                    {renderGroupHeader ? renderGroupHeader(group.key, group.items) : group.key}
                  </th>
                </tr>
              )}
              {group.items.map((item) => (
                <Fragment key={getId(item)}>{renderItemRow(item)}</Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      )}
    </table>
  );

  return (
    <div className="overflow-x-auto" onKeyDown={selectable ? handleContainerKeyDown : undefined}>
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
}
