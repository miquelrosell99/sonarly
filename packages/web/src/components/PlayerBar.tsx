import { useState, useEffect, useRef } from 'react';
import type { AutoDjMode } from '@sonarly/shared';
import { Icon } from './ui/Icon.js';
import { CoverArt } from './CoverArt.js';
import { FavoriteButton, StarRating } from './ActionButtons.js';
import { usePlayer } from '../stores/playerStore.js';
import { useSongInteraction } from '../hooks/useSongInteraction.js';
import { usePreferences, useUpdatePreferences } from '../hooks/usePreferences.js';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function ControlButton({
  children,
  active,
  disabled,
  onClick,
  onContextMenu,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  label,
  className,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: () => void;
  onTouchCancel?: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      disabled={disabled}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'text-accent' : ''} ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

function PlayButton({
  isPlaying,
  disabled,
  onClick,
}: {
  isPlaying: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      className="mx-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg-primary transition hover:scale-105 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
    >
      <Icon name={isPlaying ? 'mdi-pause' : 'mdi-play'} size={24} />
    </button>
  );
}

function Slider({
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
      className={`slider h-1 w-full cursor-pointer rounded-full text-fg-primary transition disabled:cursor-not-allowed disabled:opacity-50 ${isProgress ? 'slider-progress' : ''} ${className}`}
      style={
        {
          background: `linear-gradient(to right, hsl(var(--accent)) 0%, hsl(var(--accent)) ${percentage}%, hsl(var(--fg-primary) / 0.1) ${percentage}%, hsl(var(--fg-primary) / 0.1) 100%)`,
        } as React.CSSProperties
      }
    />
  );
}

export function PlayerBar() {
  const currentSong = usePlayer((state) => state.currentSong);
  const status = usePlayer((state) => state.status);
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);
  const volume = usePlayer((state) => state.volume);
  const shuffle = usePlayer((state) => state.shuffle);
  const repeat = usePlayer((state) => state.repeat);
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);

  const togglePlay = usePlayer((state) => state.togglePlay);
  const previous = usePlayer((state) => state.previous);
  const next = usePlayer((state) => state.next);
  const seek = usePlayer((state) => state.seek);
  const setVolume = usePlayer((state) => state.setVolume);
  const toggleShuffle = usePlayer((state) => state.toggleShuffle);
  const cycleRepeat = usePlayer((state) => state.cycleRepeat);

  const { starred, rating, setFavorite, setRating } = useSongInteraction(
    currentSong?.id,
    { starred: currentSong?.starred, rating: currentSong?.rating },
  );

  const { data: preferences } = usePreferences();
  const autoDjEnabled = preferences?.autoDjEnabled ?? false;
  const autoDjMode = preferences?.autoDjMode ?? 'smart';
  const updatePreferences = useUpdatePreferences();

  const [djMenuOpen, setDjMenuOpen] = useState(false);
  const djMenuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);

  const modeLabels: Record<AutoDjMode, string> = {
    similar: 'Similar',
    random: 'Random',
    smart: 'Smart',
  };

  const handleToggleAutoDj = () => {
    updatePreferences.mutate({ autoDjEnabled: !autoDjEnabled });
  };

  const handleSetMode = (mode: AutoDjMode) => {
    updatePreferences.mutate({ autoDjMode: mode });
    setDjMenuOpen(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDjMenuOpen(true);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    longPressStart.current = { x: touch.clientX, y: touch.clientY };
    longPressTimer.current = setTimeout(() => {
      setDjMenuOpen(true);
    }, 600);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!longPressStart.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - longPressStart.current.x);
    const dy = Math.abs(touch.clientY - longPressStart.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPress();
    }
  };

  const handleTouchEnd = () => {
    clearLongPress();
  };

  const handleTouchCancel = () => {
    clearLongPress();
  };

  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, []);

  useEffect(() => {
    if (!djMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!djMenuRef.current?.contains(e.target as Node)) {
        setDjMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [djMenuOpen]);

  const isPlaying = status === 'playing';
  const hasTrack = currentSong !== null;
  const displayDuration = duration || currentSong?.duration || 0;
  const displayTime = Math.min(currentTime, displayDuration);

  const handleFavorite = async (nextStarred: boolean) => {
    await setFavorite(nextStarred);
    updateCurrentSong({ starred: nextStarred });
  };

  const handleRate = async (nextRating?: number) => {
    await setRating(nextRating);
    updateCurrentSong({ rating: nextRating });
  };

  return (
    <footer className="relative shrink-0 overflow-hidden border-t border-rule/50 bg-surface">
      {/* Ambient wash from the currently playing cover art */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20 transition-colors duration-700"
        style={{
          background:
            'linear-gradient(to top, var(--now-playing-color, transparent) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 grid h-24 grid-cols-3 items-center gap-4 px-4">
        {/* Left: cover + metadata */}
        <div className="flex min-w-0 items-center gap-3">
          {hasTrack ? (
            <>
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md shadow-md">
                <CoverArt
                  coverArt={currentSong.coverArt}
                  alt={`Cover art for ${currentSong.title}`}
                  iconSize={20}
                />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-fg-primary">
                  {currentSong.title}
                </div>
                <div className="truncate text-xs text-fg-secondary">
                  {currentSong.artistName || 'Unknown artist'}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-surface-hover">
                <Icon name="mdi-music" size={20} className="text-fg-secondary" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-fg-primary">Not playing</div>
                <div className="text-xs text-fg-secondary">Select a track to start</div>
              </div>
            </>
          )}
        </div>

        {/* Center: transport controls + progress */}
        <div className="flex min-w-0 flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <ControlButton onClick={toggleShuffle} label="Shuffle" active={shuffle}>
              <Icon name="mdi-shuffle" size={18} />
            </ControlButton>

            <ControlButton onClick={previous} label="Previous" disabled={!hasTrack}>
              <Icon name="mdi-skip-previous" size={22} />
            </ControlButton>

            <PlayButton isPlaying={isPlaying} disabled={!hasTrack} onClick={togglePlay} />

            <ControlButton onClick={next} label="Next" disabled={!hasTrack}>
              <Icon name="mdi-skip-next" size={22} />
            </ControlButton>

            <ControlButton onClick={cycleRepeat} label={`Repeat: ${repeat}`} active={repeat !== 'off'}>
              <Icon name={repeat === 'one' ? 'mdi-repeat-once' : 'mdi-repeat'} size={18} />
            </ControlButton>
          </div>

          <div className="flex w-full max-w-md items-center gap-2">
            <span className="w-9 text-right text-xs tabular-nums text-fg-secondary">
              {formatTime(displayTime)}
            </span>
            <Slider
              min={0}
              max={displayDuration || 1}
              step={0.1}
              value={displayTime}
              onChange={seek}
              disabled={!hasTrack}
              variant="progress"
            />
            <span className="w-9 text-xs tabular-nums text-fg-secondary">
              {formatTime(displayDuration)}
            </span>
          </div>
        </div>

        {/* Right: rating + DJ placeholder / favorite + volume */}
        <div className="flex min-w-0 flex-col items-end justify-center gap-1">
          <div className="flex items-center gap-2">
            <fieldset disabled={!hasTrack} aria-label="Rating" className="m-0 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-40">
              <StarRating
                rating={rating}
                onRate={hasTrack ? handleRate : () => {}}
              />
            </fieldset>
            <div className="relative" ref={djMenuRef}>
              <ControlButton
                onClick={handleToggleAutoDj}
                onContextMenu={handleContextMenu}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                label={`Auto DJ: ${autoDjEnabled ? 'on' : 'off'}`}
                active={autoDjEnabled}
                className="touch-none select-none"
              >
                <Icon name="mdi-record-player" size={18} />
              </ControlButton>

              {djMenuOpen && (
                <div className="absolute bottom-full right-0 z-50 mb-2 min-w-[10rem] rounded-md border border-rule bg-bg-primary py-1 shadow-lg">
                  {(['similar', 'random', 'smart'] as AutoDjMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleSetMode(mode)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                    >
                      <span>{modeLabels[mode]}</span>
                      {autoDjMode === mode && (
                        <Icon name="mdi-check" size={16} className="text-accent" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FavoriteButton
              starred={starred}
              onClick={() => handleFavorite(!starred)}
              label={starred ? 'Remove favorite' : 'Add favorite'}
              disabled={!hasTrack}
            />
            <ControlButton
              onClick={() => setVolume(volume > 0 ? 0 : 1)}
              label={volume > 0 ? 'Mute' : 'Unmute'}
            >
              <Icon name={volume > 0 ? 'mdi-volume-high' : 'mdi-volume-mute'} size={18} />
            </ControlButton>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={setVolume}
              ariaLabel="Volume"
              className="w-24"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
