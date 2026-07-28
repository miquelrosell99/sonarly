import { useState } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';

type ActionVariant = 'default' | 'overlay';

interface FavoriteButtonProps {
  starred?: boolean;
  onClick: () => void;
  label?: string;
  className?: string;
  variant?: ActionVariant;
  disabled?: boolean;
}

export function FavoriteButton({ starred, onClick, label, className, variant = 'default', disabled }: FavoriteButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-label={label ?? (starred ? 'Remove favorite' : 'Add favorite')}
      title={label ?? (starred ? 'Remove favorite' : 'Add favorite')}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        starred
          ? 'text-accent hover:bg-accent/10'
          : variant === 'overlay'
            ? 'text-white/80 hover:bg-white/20 hover:text-white'
            : 'text-muted hover:bg-fg-primary/10 hover:text-accent',
        className,
      )}
    >
      <Icon name={starred ? 'mdi-heart' : 'mdi-heart-outline'} size={18} />
    </button>
  );
}

interface StarRatingProps {
  rating?: number;
  onRate: (rating: number) => void;
  className?: string;
  variant?: ActionVariant;
}

export function StarRating({ rating = 0, onRate, className, variant = 'default' }: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? rating;

  const isOverlay = variant === 'overlay';

  const resolveTarget = (e: React.MouseEvent<HTMLButtonElement>, value: number): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isLeftHalf = e.clientX - rect.left < rect.width / 2;
    return isLeftHalf ? value - 0.5 : value;
  };

  const handleMove = (e: React.MouseEvent<HTMLButtonElement>, value: number) => {
    setHover(resolveTarget(e, value));
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>, value: number) => {
    const target = resolveTarget(e, value);
    onRate(target === rating ? 0 : target);
  };

  return (
    <span
      className={cn('inline-flex items-center', isOverlay ? 'gap-0' : 'gap-0.5', className)}
      onMouseLeave={() => setHover(null)}
      role="group"
      aria-label="Rating"
    >
      {[1, 2, 3, 4, 5].map((value) => {
        const filled = display >= value;
        const half = !filled && display >= value - 0.5;
        const icon = filled ? 'mdi-star' : half ? 'mdi-star-half-full' : 'mdi-star-outline';
        const label = half ? `Rate ${value - 0.5} stars` : `Rate ${value} stars`;
        return (
          <button
            key={value}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClick(e, value);
            }}
            onMouseMove={(e) => handleMove(e, value)}
            onMouseEnter={(e) => handleMove(e, value)}
            aria-label={label}
            className={cn(
              'rounded transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              isOverlay ? 'p-0' : 'p-0.5',
              filled || half
                ? 'text-accent'
                : isOverlay
                  ? 'text-white/80 hover:text-white'
                  : 'text-muted hover:text-accent/70',
            )}
          >
            <Icon
              name={icon}
              size={isOverlay ? 14 : 16}
            />
          </button>
        );
      })}
    </span>
  );
}
