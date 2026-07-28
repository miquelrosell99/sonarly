import { Children, type MouseEvent, type KeyboardEvent, type ReactNode, cloneElement, isValidElement } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { PlayButton } from './PlayButton.js';
import { FavoriteButton, StarRating } from './ActionButtons.js';

export interface ListRowActionFavorite {
  starred?: boolean;
  onClick: () => void;
}

export interface ListRowActionRating {
  value?: number;
  onRate: (rating: number) => void;
}

interface ListRowProps {
  href?: string;
  index: number;
  isSelected?: boolean;
  isPlayingTitle?: boolean;
  onSelect?: (e: MouseEvent) => void;
  onActivate?: () => void;
  onPlay?: () => void;
  onShufflePlay?: () => void;
  playLabel?: string;
  favorite?: ListRowActionFavorite;
  rating?: ListRowActionRating;
  onContextMenu?: (e: React.MouseEvent) => void;
  sortable?: boolean;
  sortableRef?: React.Ref<HTMLTableRowElement>;
  sortableStyle?: React.CSSProperties;
  isDragging?: boolean;
  dragHandleProps?: Record<string, unknown>;
  children: ReactNode;
}

function isInteractiveTarget(target: EventTarget, currentTarget: EventTarget) {
  let node: Node | null = target as Node;
  while (node && node !== currentTarget) {
    if (node instanceof Element) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'a' || tag === 'button' || node.getAttribute('role') === 'menuitem') {
        return true;
      }
    }
    node = node.parentNode;
  }
  return false;
}

export function ListRow({
  index,
  isSelected = false,
  isPlayingTitle = false,
  onSelect,
  onActivate,
  onPlay,
  onShufflePlay,
  playLabel,
  favorite,
  rating,
  onContextMenu,
  sortable = false,
  sortableRef,
  sortableStyle,
  isDragging = false,
  dragHandleProps,
  children,
}: ListRowProps) {
  const handleClick = (e: MouseEvent) => {
    if (isInteractiveTarget(e.target, e.currentTarget)) return;
    onSelect?.(e);
  };

  const handleDoubleClick = (e: MouseEvent) => {
    if (isInteractiveTarget(e.target, e.currentTarget)) return;
    onActivate?.();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onActivate?.();
    }
  };

  const cells = Children.toArray(children);
  const titleCell = cells[0];
  const restCells = cells.slice(1);

  const highlightedTitle = isValidElement(titleCell)
    ? cloneElement(titleCell, {
        className: cn(
          (titleCell.props as { className?: string }).className,
          isPlayingTitle && 'text-accent',
        ),
      })
    : titleCell;

  return (
    <tr
      ref={sortableRef}
      style={sortableStyle}
      tabIndex={0}
      aria-selected={isSelected}
      className={cn(
        'group cursor-pointer select-none transition outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        isSelected ? 'bg-surface-hover' : 'hover:bg-surface-hover',
        isDragging && 'z-10 scale-[1.02] shadow-lg',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
    >
      {sortable && (
        <td className="w-8 py-2 pr-2">
          <button
            type="button"
            {...dragHandleProps}
            aria-label="Drag to reorder"
            className="cursor-grab text-fg-secondary opacity-0 transition hover:text-fg-primary group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          >
            <Icon name="mdi-drag-vertical" size={18} />
          </button>
        </td>
      )}
      <td className="w-12 py-2 pr-4">
        <span className="relative grid h-5 w-6 place-items-center text-muted">
          <span className="col-start-1 row-start-1 transition group-hover:opacity-0">{index + 1}</span>
          {onPlay && (
            <span className="col-start-1 row-start-1 opacity-0 transition group-hover:opacity-100">
              <PlayButton
                variant="inline"
                onPlay={onPlay}
                onShufflePlay={onShufflePlay}
                label={playLabel}
              />
            </span>
          )}
        </span>
      </td>
      {highlightedTitle}
      {restCells}
      {favorite && (
        <td className="py-2 pr-4">
          <FavoriteButton starred={favorite.starred} onClick={favorite.onClick} />
        </td>
      )}
      {rating && (
        <td className="py-2 pr-4">
          <StarRating rating={rating.value} onRate={rating.onRate} />
        </td>
      )}
    </tr>
  );
}
