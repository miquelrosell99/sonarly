import { Children, type MouseEvent, type KeyboardEvent, type ReactNode, cloneElement, isValidElement } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { PlayButton } from './PlayButton.js';
import { FavoriteButton, StarRating } from './ActionButtons.js';
import { PlayingIndicator } from './PlayingIndicator.js';

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
  isPlaying?: boolean;
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
  className?: string;
  indexPad?: number;
  indexLabel?: ReactNode;
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
  isPlaying = false,
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
  className,
  indexPad,
  indexLabel,
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
          isPlaying && 'text-accent',
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
        'group h-12 cursor-pointer select-none transition outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        isSelected ? 'bg-surface-hover' : 'hover:bg-surface-hover',
        isPlaying && 'bg-accent/10',
        isDragging && 'z-10 scale-[1.02] shadow-lg',
        className,
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
    >
      {sortable && (
        <td className="w-8 whitespace-nowrap py-2 pr-2">
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
      <td className="w-12 whitespace-nowrap py-2 px-2 text-center">
        <span className="group/play relative inline-flex h-5 w-6 items-center justify-center text-muted">
          <span className="transition group-hover/play:opacity-0">
            {isPlaying ? (
              <PlayingIndicator size={14} />
            ) : indexLabel !== undefined && indexLabel !== null ? (
              typeof indexLabel === 'number' && indexPad ? (
                String(indexLabel).padStart(indexPad, '0')
              ) : (
                indexLabel
              )
            ) : indexPad ? (
              (index + 1).toString().padStart(indexPad, '0')
            ) : (
              index + 1
            )}
          </span>
          {onPlay && (
            <span className="hover-reveal pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-focus-within/play:opacity-100 group-hover/play:opacity-100">
              <span className="pointer-events-auto">
                <PlayButton
                  variant="inline"
                  onPlay={onPlay}
                  onShufflePlay={onShufflePlay}
                  label={playLabel}
                />
              </span>
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
