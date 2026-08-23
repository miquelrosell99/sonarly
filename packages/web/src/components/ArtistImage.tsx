import { useState } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';

interface ArtistImageProps {
  artistId: string;
  alt: string;
  iconSize?: number;
  className?: string;
  shape?: 'circle' | 'rounded';
}

export function ArtistImage({
  artistId,
  alt,
  iconSize = 32,
  className,
  shape = 'rounded',
}: ArtistImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return (
      <div
        className={cn(
          'flex aspect-square items-center justify-center bg-surface-hover',
          shape === 'circle' ? 'rounded-full' : 'rounded-xl',
          className,
        )}
      >
        <Icon name="mdi-account-music" size={iconSize} className="text-fg-secondary" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'aspect-square overflow-hidden bg-surface-hover',
        shape === 'circle' ? 'rounded-full' : 'rounded-xl',
        className,
      )}
    >
      <img
        src={`/api/artist-images/${artistId}`}
        alt={alt}
        loading="lazy"
        className={cn(
          'h-full w-full object-cover motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-out',
          loaded ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-sm scale-105',
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
