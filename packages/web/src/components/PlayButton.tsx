import { type PointerEvent, type ReactNode, type MouseEvent } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { useClickAndHold } from '../hooks/useClickAndHold.js';

export interface PlayButtonProps {
  onPlay: () => void;
  onShufflePlay?: () => void;
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
        className={cn('text-accent', isHolding && 'transition-[stroke-dashoffset] duration-500 ease-linear')}
      />
    </svg>
  );
}

function PlayButtonHold(props: PlayButtonProps & { onShufflePlay: () => void }) {
  const { onPlay, onShufflePlay, label, variant, className, disabled, children } = props;
  const { isHolding, handlers } = useClickAndHold({
    onClick: onPlay,
    onHold: onShufflePlay,
    threshold: 500,
  });

  return (
    <PlayButtonContent
      onPlay={onPlay}
      label={label}
      variant={variant}
      className={className}
      disabled={disabled}
      children={children}
      isHolding={isHolding}
      handlers={handlers}
    />
  );
}

interface Handlers {
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

function PlayButtonContent({
  onPlay,
  label,
  variant = 'default',
  className,
  disabled,
  children,
  isHolding = false,
  handlers,
}: PlayButtonProps & { isHolding?: boolean; handlers?: Handlers }) {
  const ariaLabel = handlers
    ? (label ? `${label} (hold to shuffle)` : typeof children === 'string' ? `${children} (hold to shuffle)` : 'Play (hold to shuffle)')
    : (label ?? (typeof children === 'string' ? children : 'Play'));

  const baseProps = {
    type: 'button' as const,
    disabled,
    'aria-label': ariaLabel,
    style: { touchAction: 'none' as const },
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
    },
  };

  const handleClick = handlers
    ? (e: MouseEvent<HTMLButtonElement>) => {
        handlers.onClick(e);
        // Always stop propagation regardless of whether the hook consumed
        // the synthetic click after a pointer gesture or invoked onPlay for
        // keyboard/screen-reader activation.
        e.stopPropagation();
      }
    : (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        onPlay();
      };

  if (variant === 'overlay') {
    return (
      <button
        {...baseProps}
        className={cn(
          'group relative flex h-11 w-11 items-center justify-center rounded-full bg-accent text-bg-primary shadow-lg shadow-black/30 transition-all duration-200 hover:scale-105 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        onClick={handleClick}
        {...(handlers ? pointerHandlers(handlers) : {})}
      >
        <ProgressRing isHolding={isHolding} size={44} />
        <Icon name="mdi-play" size={22} className="relative z-10" />
        {handlers && (
          <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-bg-primary px-2 py-1 text-xs text-fg-primary opacity-0 shadow ring-1 ring-rule transition-opacity delay-700 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            Hold to shuffle
          </span>
        )}
      </button>
    );
  }

  if (variant === 'inline') {
    return (
      <button
        {...baseProps}
        className={cn(
          'group relative inline-flex h-5 w-5 items-center justify-center text-accent transition hover:text-accent/80 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        onClick={handleClick}
        {...(handlers ? pointerHandlers(handlers) : {})}
      >
        <ProgressRing isHolding={isHolding} size={20} />
        <Icon name="mdi-play" size={16} className="relative z-10" />
        {handlers && (
          <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-bg-primary px-2 py-1 text-xs text-fg-primary opacity-0 shadow ring-1 ring-rule transition-opacity delay-700 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            Hold to shuffle
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      {...baseProps}
      className={cn(
        'btn group relative inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      onClick={handleClick}
      {...(handlers ? pointerHandlers(handlers) : {})}
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        <ProgressRing isHolding={isHolding} size={20} />
        <Icon name="mdi-play" size={16} className="relative z-10" />
      </span>
      {children}
      {handlers && (
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-bg-primary px-2 py-1 text-xs text-fg-primary opacity-0 shadow ring-1 ring-rule transition-opacity delay-700 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          Hold to shuffle
        </span>
      )}
    </button>
  );
}

function pointerHandlers(handlers: Handlers) {
  return {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      handlers.onPointerDown(e);
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      handlers.onPointerUp(e);
    },
    onPointerLeave: handlers.onPointerLeave,
    onPointerCancel: handlers.onPointerCancel,
  };
}

export function PlayButton(props: PlayButtonProps) {
  const { onShufflePlay } = props;
  if (!onShufflePlay) {
    return <PlayButtonContent {...props} />;
  }
  return <PlayButtonHold {...props} onShufflePlay={onShufflePlay} />;
}
