import { cn } from '../lib/cn.js';

interface PlayingIndicatorProps {
  size?: number;
  className?: string;
}

export function PlayingIndicator({ size = 16, className }: PlayingIndicatorProps) {
  return (
    <div
      role="img"
      className={cn('flex items-end justify-center gap-[2px]', className)}
      style={{ width: size, height: size }}
      aria-label="Playing"
    >
      {[0, 0.2, 0.4].map((delay, i) => (
        <span
          key={i}
          className="playing-indicator-bar h-full w-[2px] rounded-full bg-accent"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  );
}
