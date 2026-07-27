import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { useClickAndHold } from '../hooks/useClickAndHold.js';

export interface PlayButtonProps {
  onPlay: () => void;
  onShufflePlay: () => void;
  label?: string;
  variant?: 'default' | 'overlay' | 'inline';
  className?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}

function ProgressRing({ isHolding, size = 40 }: { isHolding: boolean; size?: number }) {
  const strokeWidth = size * 0.1;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      width={size}
      height={size}
      className="pointer-events-none absolute inset-0 -rotate-90 transition-opacity"
      style={{ opacity: isHolding ? 1 : 0 }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={isHolding ? 0 : circumference}
        className="text-accent transition-[stroke-dashoffset] duration-500 ease-linear"
      />
    </svg>
  );
}

export function PlayButton({
  onPlay,
  onShufflePlay,
  label,
  variant = 'default',
  className,
  disabled,
  children,
}: PlayButtonProps) {
  const { isHolding, handlers } = useClickAndHold({
    onClick: onPlay,
    onHold: onShufflePlay,
    threshold: 500,
  });

  const ariaLabel = label ? `Play ${label} (hold to shuffle)` : 'Play (hold to shuffle)';

  if (variant === 'overlay') {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'group relative flex h-11 w-11 items-center justify-center rounded-full bg-accent text-bg-primary shadow-lg shadow-black/30 transition-all duration-200 hover:scale-105 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        style={{ touchAction: 'none' }}
        {...handlers}
      >
        <ProgressRing isHolding={isHolding} size={44} />
        <Icon name="mdi-play" size={22} className="relative z-10" />
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-bg-primary px-2 py-1 text-xs text-fg-primary opacity-0 shadow ring-1 ring-rule transition-opacity delay-700 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          Hold to shuffle
        </span>
      </button>
    );
  }

  if (variant === 'inline') {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'group relative inline-flex h-6 w-6 items-center justify-center text-accent transition hover:text-accent/80 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        style={{ touchAction: 'none' }}
        {...handlers}
      >
        <ProgressRing isHolding={isHolding} size={24} />
        <Icon name="mdi-play" size={18} className="relative z-10" />
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-bg-primary px-2 py-1 text-xs text-fg-primary opacity-0 shadow ring-1 ring-rule transition-opacity delay-700 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          Hold to shuffle
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'btn group relative inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      style={{ touchAction: 'none' }}
      {...handlers}
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        <ProgressRing isHolding={isHolding} size={20} />
        <Icon name="mdi-play" size={16} className="relative z-10" />
      </span>
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-bg-primary px-2 py-1 text-xs text-fg-primary opacity-0 shadow ring-1 ring-rule transition-opacity delay-700 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        Hold to shuffle
      </span>
    </button>
  );
}
