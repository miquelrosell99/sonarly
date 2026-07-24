import { useState } from 'react';
import { Icon } from './ui/Icon.js';

interface CoverArtProps {
  coverArt?: string;
  alt: string;
  iconSize?: number;
}

export function CoverArt({ coverArt, alt, iconSize = 32 }: CoverArtProps) {
  const [failed, setFailed] = useState(false);

  if (!coverArt || failed) {
    return (
      <div className="flex aspect-square items-center justify-center bg-surface-hover">
        <Icon name="mdi-album" size={iconSize} className="text-muted" />
      </div>
    );
  }

  return (
    <div className="aspect-square overflow-hidden bg-surface-hover">
      <img
        src={`/api/cover-art/${coverArt}`}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
