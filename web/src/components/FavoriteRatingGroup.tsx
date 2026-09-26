import { FavoriteButton, StarRating } from './ActionButtons.js';
import { cn } from '../lib/cn.js';

interface FavoriteRatingGroupProps {
  starred?: boolean;
  onToggleFavorite: () => void;
  rating?: number;
  onRate: (rating: number) => void;
  favoriteLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function FavoriteRatingGroup({
  starred,
  onToggleFavorite,
  rating,
  onRate,
  favoriteLabel,
  className,
  size = 'md',
}: FavoriteRatingGroupProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <FavoriteButton
        starred={starred}
        onClick={onToggleFavorite}
        label={favoriteLabel}
        className={cn(size === 'sm' && 'p-1')}
      />
      <StarRating
        rating={rating}
        onRate={onRate}
        className={cn(size === 'sm' && 'gap-0')}
      />
    </span>
  );
}
