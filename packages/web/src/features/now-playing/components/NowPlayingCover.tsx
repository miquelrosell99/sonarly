import { cn } from '../../../lib/cn.js';
import { CoverArt } from '../../../components/CoverArt.js';

interface NowPlayingCoverProps {
  coverArt?: string;
  alt: string;
  className?: string;
}

export function NowPlayingCover({ coverArt, alt, className }: NowPlayingCoverProps) {
  return (
    <div
      className={cn(
        'relative aspect-square w-full max-w-[420px] overflow-hidden rounded-2xl shadow-2xl',
        className
      )}
    >
      <CoverArt coverArt={coverArt} alt={alt} iconSize={64} className="h-full w-full" />
    </div>
  );
}
