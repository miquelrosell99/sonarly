import { cn } from '../../lib/cn.js';

// Loading placeholder shaped like a block of real content. The pulse is
// disabled under prefers-reduced-motion both by the global guard in
// index.css and by the explicit motion-reduce: variant below.
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover', className)}
    />
  );
}
