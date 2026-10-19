import type { MouseEvent, ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../lib/cn.js';
import { ListRow } from '../../components/ListRow.js';
import type { LibraryViewColumn } from './types.js';

interface SortableLibraryRowProps<T> {
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
}

export function SortableLibraryRow<T>({
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
}: SortableLibraryRowProps<T>) {
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
