import { Icon } from './ui/Icon.js';
import { usePlayer } from '../stores/playerStore.js';

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
  label,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded text-fg-primary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'text-accent' : ''}`}
    >
      {children}
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
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
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
      className={`h-1.5 w-full cursor-pointer appearance-none rounded bg-rule accent-accent transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
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

  const togglePlay = usePlayer((state) => state.togglePlay);
  const previous = usePlayer((state) => state.previous);
  const next = usePlayer((state) => state.next);
  const seek = usePlayer((state) => state.seek);
  const setVolume = usePlayer((state) => state.setVolume);
  const toggleShuffle = usePlayer((state) => state.toggleShuffle);
  const cycleRepeat = usePlayer((state) => state.cycleRepeat);

  const isPlaying = status === 'playing';
  const hasTrack = currentSong !== null;
  const displayDuration = duration || currentSong?.duration || 0;
  const displayTime = Math.min(currentTime, displayDuration);

  return (
    <footer className="flex shrink-0 flex-col border-t border-rule bg-surface">
      <div className="flex items-center gap-3 px-4 pt-2">
        <span className="w-10 text-right text-xs text-muted tabular-nums">{formatTime(displayTime)}</span>
        <Slider
          min={0}
          max={displayDuration || 1}
          step={0.1}
          value={displayTime}
          onChange={seek}
          disabled={!hasTrack}
        />
        <span className="w-10 text-xs text-muted tabular-nums">{formatTime(displayDuration)}</span>
      </div>

      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex w-1/4 min-w-0 items-center gap-3">
          {hasTrack ? (
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-fg-primary">{currentSong.title}</div>
              <div className="truncate text-xs text-muted">{currentSong.artistName || 'Unknown artist'}</div>
            </div>
          ) : (
            <span className="text-sm text-muted">No track selected</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <ControlButton onClick={toggleShuffle} label="Shuffle" active={shuffle}>
            <Icon name="mdi-shuffle" size={20} />
          </ControlButton>

          <ControlButton onClick={previous} label="Previous" disabled={!hasTrack}>
            <Icon name="mdi-skip-previous" size={24} />
          </ControlButton>

          <ControlButton onClick={togglePlay} label={isPlaying ? 'Pause' : 'Play'} disabled={!hasTrack}>
            <Icon name={isPlaying ? 'mdi-pause' : 'mdi-play'} size={28} />
          </ControlButton>

          <ControlButton onClick={next} label="Next" disabled={!hasTrack}>
            <Icon name="mdi-skip-next" size={24} />
          </ControlButton>

          <ControlButton onClick={cycleRepeat} label={`Repeat: ${repeat}`} active={repeat !== 'off'}>
            <Icon name={repeat === 'one' ? 'mdi-repeat-once' : 'mdi-repeat'} size={20} />
          </ControlButton>
        </div>

        <div className="flex w-1/4 min-w-0 items-center justify-end gap-2">
          <ControlButton
            onClick={() => setVolume(volume > 0 ? 0 : 1)}
            label={volume > 0 ? 'Mute' : 'Unmute'}
          >
            <Icon name={volume > 0 ? 'mdi-volume-high' : 'mdi-volume-mute'} size={20} />
          </ControlButton>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={setVolume}
            ariaLabel="Volume"
            className="max-w-28"
          />
        </div>
      </div>
    </footer>
  );
}
