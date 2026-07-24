import type { ReactNode } from 'react';
import { useLocation } from 'wouter';
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
  href: string;
  index: number;
  children: ReactNode;
  onPlay?: () => void;
  playLabel?: string;
  favorite?: ListRowActionFavorite;
  rating?: ListRowActionRating;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function isInteractiveTarget(target: EventTarget) {
  const el = target as HTMLElement;
  return el.closest('a, button, [role="menuitem"]') !== null;
}

export function ListRow({
  href,
  index,
  children,
  onPlay,
  playLabel,
  favorite,
  rating,
  onContextMenu,
}: ListRowProps) {
  const [, setLocation] = useLocation();

  return (
    <tr
      className="group cursor-pointer transition hover:bg-surface-hover"
      onClick={(e) => {
        if (!isInteractiveTarget(e.target)) {
          setLocation(href);
        }
      }}
      onContextMenu={onContextMenu}
    >
      <td className="py-2 pr-4">
        <span className="inline-flex items-center text-muted">
          <span className="group-hover:hidden">{index + 1}</span>
          {onPlay && (
            <button
              type="button"
              className="hidden text-accent hover:text-accent/80 focus-visible:outline-none group-hover:inline-flex"
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
      {children}
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
