import { cn } from '../../lib/cn.js';

interface ProgressBarProps {
  value: number;
  className?: string;
  'aria-label'?: string;
}

export function ProgressBar({ value, className, 'aria-label': ariaLabel }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-hover', className)}>
      <div
        className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
