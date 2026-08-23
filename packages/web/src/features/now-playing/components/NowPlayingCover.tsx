import { useEffect, useState } from 'react';
import { cn } from '../../../lib/cn.js';
import { CoverArt } from '../../../components/CoverArt.js';

interface NowPlayingCoverProps {
  coverArt?: string;
  alt: string;
  className?: string;
}

export function NowPlayingCover({ coverArt, alt, className }: NowPlayingCoverProps) {
  // Brief settle-in transition when the track changes. The global
  // prefers-reduced-motion dampener zeroes the transition duration, and
  // motion-reduce:transition-none skips it entirely.
  const [settled, setSettled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setSettled(false);
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled && typeof window !== 'undefined') setSettled(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [coverArt]);

  return (
    <div
      className={cn(
        'relative aspect-square w-full max-w-[420px] overflow-hidden rounded-2xl shadow-2xl shadow-black/40 ring-1 ring-fg-primary/10',
        'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
        settled ? 'scale-100 opacity-100' : 'scale-[0.96] opacity-60',
        className
      )}
    >
      <CoverArt coverArt={coverArt} alt={alt} iconSize={64} className="h-full w-full" />
    </div>
  );
}
