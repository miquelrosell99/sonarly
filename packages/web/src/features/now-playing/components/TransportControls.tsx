import { Icon } from '../../../components/ui/Icon.js';
import { usePlayer } from '../../../stores/playerStore.js';

function ControlButton({
  children,
  active,
  disabled,
  onClick,
  label,
  className,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'text-accent' : ''} ${className ?? ''}`}
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
      className="mx-2 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg-primary transition hover:scale-105 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
    >
      <Icon name={isPlaying ? 'mdi-pause' : 'mdi-play'} size={32} />
    </button>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function TransportControls() {
  const currentSong = usePlayer((state) => state.currentSong);
  const status = usePlayer((state) => state.status);
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);
  const shuffle = usePlayer((state) => state.shuffle);
  const repeat = usePlayer((state) => state.repeat);

  const togglePlay = usePlayer((state) => state.togglePlay);
  const previous = usePlayer((state) => state.previous);
  const next = usePlayer((state) => state.next);
  const seek = usePlayer((state) => state.seek);
  const toggleShuffle = usePlayer((state) => state.toggleShuffle);
  const cycleRepeat = usePlayer((state) => state.cycleRepeat);

  const isPlaying = status === 'playing';
  const hasTrack = currentSong !== null;
  const displayDuration = duration || currentSong?.duration || 0;
  const displayTime = Math.min(currentTime, displayDuration);

  const percentage = displayDuration === 0 ? 0 : (displayTime / displayDuration) * 100;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <div className="flex items-center gap-1">
        <ControlButton onClick={toggleShuffle} label="Shuffle" active={shuffle}>
          <Icon name="mdi-shuffle" size={22} />
        </ControlButton>
        <ControlButton onClick={previous} label="Previous" disabled={!hasTrack}>
          <Icon name="mdi-skip-previous" size={28} />
        </ControlButton>
        <PlayButton isPlaying={isPlaying} disabled={!hasTrack} onClick={togglePlay} />
        <ControlButton onClick={next} label="Next" disabled={!hasTrack}>
          <Icon name="mdi-skip-next" size={28} />
        </ControlButton>
        <ControlButton onClick={cycleRepeat} label={`Repeat: ${repeat}`} active={repeat !== 'off'}>
          <Icon name={repeat === 'one' ? 'mdi-repeat-once' : 'mdi-repeat'} size={22} />
        </ControlButton>
      </div>
      <div className="flex w-full items-center gap-3">
        <span className="w-10 text-right text-xs tabular-nums text-fg-secondary">{formatTime(displayTime)}</span>
        <input
          type="range"
          min={0}
          max={displayDuration || 1}
          step={0.1}
          value={displayTime}
          disabled={!hasTrack}
          aria-label="Progress"
          onChange={(e) => seek(parseFloat(e.target.value))}
          className="slider slider-progress h-2 w-full cursor-pointer rounded-full"
          style={{
            background: `linear-gradient(to right, hsl(var(--accent)) 0%, hsl(var(--accent)) ${percentage}%, hsl(var(--fg-primary) / 0.1) ${percentage}%, hsl(var(--fg-primary) / 0.1) 100%)`,
          }}
        />
        <span className="w-10 text-xs tabular-nums text-fg-secondary">{formatTime(displayDuration)}</span>
      </div>
    </div>
  );
}
