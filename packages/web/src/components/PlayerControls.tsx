import { forwardRef } from 'react';
import { Icon } from './ui/Icon.js';
import { cn } from '../lib/cn.js';

export const ControlButton = forwardRef<HTMLButtonElement, {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  label: string;
  className?: string;
}>(({
  children,
  active,
  disabled,
  onClick,
  onContextMenu,
  label,
  className,
}, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-accent/15 text-accent hover:bg-accent/25'
          : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
        className,
      )}
    >
      {children}
    </button>
  );
});

ControlButton.displayName = 'ControlButton';

export function PlayButton({
  isPlaying,
  disabled,
  onClick,
  className,
  iconSize = 24,
}: {
  isPlaying: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  iconSize?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      className={cn(
        'mx-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg-primary transition',
        'hover:scale-105 hover:brightness-110',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100',
        className,
      )}
    >
      <Icon name={isPlaying ? 'mdi-pause' : 'mdi-play'} size={iconSize} />
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  className = '',
  ariaLabel,
  variant = 'volume',
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  variant?: 'progress' | 'volume';
}) {
  const range = max - min;
  const percentage = range === 0 ? 0 : ((value - min) / range) * 100;
  const isProgress = variant === 'progress';

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={cn(
        'slider h-1 w-full cursor-pointer rounded-full text-fg-primary transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        isProgress && 'slider-progress',
        className,
      )}
      style={
        {
          background: `linear-gradient(to right, hsl(var(--accent)) 0%, hsl(var(--accent)) ${percentage}%, hsl(var(--fg-primary) / 0.1) ${percentage}%, hsl(var(--fg-primary) / 0.1) 100%)`,
        } as React.CSSProperties
      }
    />
  );
}
