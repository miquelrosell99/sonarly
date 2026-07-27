import { useState } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';

interface CoverArtProps {
  coverArt?: string;
  alt: string;
  iconSize?: number;
  className?: string;
}

export function CoverArt({ coverArt, alt, iconSize = 32, className }: CoverArtProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!coverArt || failed) {
    return (
      <div
        className={cn(
          'flex aspect-square items-center justify-center bg-surface-hover',
          className,
        )}
      >
        <Icon name="mdi-album" size={iconSize} className="text-fg-secondary" />
      </div>
    );
  }

  return (
    <div className={cn('aspect-square overflow-hidden bg-surface-hover', className)}>
      <img
        src={`/api/cover-art/${coverArt}`}
        alt={alt}
        loading="lazy"
        className={cn(
          'h-full w-full object-cover transition-all duration-700 ease-out',
          loaded ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-sm scale-105',
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
