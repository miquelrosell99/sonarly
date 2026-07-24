import { Children, type MouseEvent, type KeyboardEvent, type ReactNode, cloneElement, isValidElement } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
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
  index: number;
  isSelected?: boolean;
  isPlayingTitle?: boolean;
  onSelect?: (e: MouseEvent) => void;
  onActivate?: () => void;
  onPlay?: () => void;
  playLabel?: string;
  favorite?: ListRowActionFavorite;
  rating?: ListRowActionRating;
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
  playLabel,
  favorite,
  rating,
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
      tabIndex={0}
      aria-selected={isSelected}
      className={cn(
        'group cursor-pointer select-none transition outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        isSelected ? 'bg-surface-hover' : 'hover:bg-surface-hover',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <td className="w-12 py-2 pr-4">
        <span className="relative inline-flex h-5 w-6 items-center justify-center text-muted">
          <span className="group-hover:opacity-0">{index + 1}</span>
          {onPlay && (
            <button
              type="button"
              className="absolute inset-0 inline-flex items-center justify-center text-accent opacity-0 hover:text-accent/80 focus-visible:outline-none group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              aria-label={playLabel ?? 'Play'}
            >
              <Icon name="mdi-play" size={18} />
            </button>
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
