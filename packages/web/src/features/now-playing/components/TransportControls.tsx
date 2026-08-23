import { Icon } from '../../../components/ui/Icon.js';
import { ControlButton, PlayButton, Slider } from '../../../components/PlayerControls.js';
import { cn } from '../../../lib/cn.js';
import { usePlayer } from '../../../stores/playerStore.js';

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
  const volume = usePlayer((state) => state.volume);
  const setVolume = usePlayer((state) => state.setVolume);

  const isPlaying = status === 'playing';
  const hasTrack = currentSong !== null;
  const displayDuration = duration || currentSong?.duration || 0;
  const displayTime = Math.min(currentTime, displayDuration);

  return (
    <div className={cn('flex w-full max-w-md flex-col items-center gap-3')}>
      <div className={cn('flex flex-wrap items-center justify-center gap-1 sm:gap-2')}>
        <ControlButton onClick={toggleShuffle} label="Shuffle" active={shuffle} className="h-11 w-11">
          <Icon name="mdi-shuffle" size={20} />
        </ControlButton>
        <ControlButton onClick={previous} label="Previous" disabled={!hasTrack} className="h-11 w-11">
          <Icon name="mdi-skip-previous" size={30} />
        </ControlButton>
        <PlayButton
          isPlaying={isPlaying}
          disabled={!hasTrack}
          onClick={togglePlay}
          className="mx-2 h-14 w-14 shadow-lg shadow-accent/30"
          iconSize={32}
        />
        <ControlButton onClick={next} label="Next" disabled={!hasTrack} className="h-11 w-11">
          <Icon name="mdi-skip-next" size={30} />
        </ControlButton>
        <ControlButton onClick={cycleRepeat} label={`Repeat: ${repeat}`} active={repeat !== 'off'} className="h-11 w-11">
          <Icon name={repeat === 'one' ? 'mdi-repeat-once' : 'mdi-repeat'} size={20} />
        </ControlButton>
      </div>
      <div className={cn('flex w-full items-center gap-3')}>
        <span className="w-11 shrink-0 text-right text-xs font-mono tabular-nums text-fg-secondary">{formatTime(displayTime)}</span>
        <Slider
          min={0}
          max={displayDuration || 1}
          step={0.1}
          value={displayTime}
          onChange={seek}
          disabled={!hasTrack}
          ariaLabel="Progress"
          variant="progress"
          className="h-2"
        />
        <span className="w-11 shrink-0 text-xs font-mono tabular-nums text-fg-secondary">{formatTime(displayDuration)}</span>
      </div>
      <div className={cn('flex items-center justify-center gap-1')}>
        <ControlButton
          onClick={() => setVolume(volume > 0 ? 0 : 1)}
          label={volume > 0 ? 'Mute' : 'Unmute'}
          className="h-11 w-11"
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
          className="w-28"
        />
      </div>
    </div>
  );
}
