import { Link } from 'wouter';
import type { AutoDjMode } from '@sonarly/shared';
import { Icon } from './ui/Icon.js';
import { CoverArt } from './CoverArt.js';
import { FavoriteButton, StarRating } from './ActionButtons.js';
import { ItemContextMenu } from './ItemContextMenu.js';
import { ControlButton, PlayButton, Slider } from './PlayerControls.js';
import { usePlayer } from '../stores/playerStore.js';
import { useSongInteraction } from '../hooks/useSongInteraction.js';
import { usePreferences, useUpdatePreferences } from '../hooks/usePreferences.js';
import { useNowPlaying } from '../features/now-playing/index.js';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  const openNowPlaying = useNowPlaying((state) => state.open);

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

  const handleToggleAutoDj = () => {
    updatePreferences.mutate({ autoDjEnabled: !autoDjEnabled });
  };

  const djModeItems: { id: AutoDjMode; label: string; icon: string }[] = [
    { id: 'similar', label: 'Similar', icon: 'mdi-account-music' },
    { id: 'random', label: 'Random', icon: 'mdi-shuffle' },
    { id: 'smart', label: 'Smart', icon: 'mdi-brain' },
  ];

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
              <button
                type="button"
                onClick={openNowPlaying}
                aria-label="Open Now Playing"
                className="h-14 w-14 shrink-0 overflow-hidden rounded-md shadow-md transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <CoverArt
                  coverArt={currentSong.coverArt}
                  alt={`Cover art for ${currentSong.title}`}
                  iconSize={20}
                />
              </button>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-fg-primary">
                  {currentSong.title}
                </div>
                {currentSong.albumName && (
                  <div className="truncate text-xs text-fg-secondary">
                    {currentSong.albumId ? (
                      <Link
                        href={`/albums/${currentSong.albumId}`}
                        className="hover:text-accent"
                      >
                        {currentSong.albumName}
                      </Link>
                    ) : (
                      currentSong.albumName
                    )}
                  </div>
                )}
                <div className="truncate text-xs text-fg-secondary">
                  {currentSong.artistEntries && currentSong.artistEntries.length > 0 ? (
                    currentSong.artistEntries.map((artist, index) => (
                      <span key={artist.id}>
                        <Link
                          href={`/artists/${artist.id}`}
                          className="hover:text-accent"
                        >
                          {artist.name}
                        </Link>
                        {index < currentSong.artistEntries!.length - 1 && ', '}
                      </span>
                    ))
                  ) : currentSong.artistId ? (
                    <Link
                      href={`/artists/${currentSong.artistId}`}
                      className="hover:text-accent"
                    >
                      {currentSong.artistName || 'Unknown artist'}
                    </Link>
                  ) : (
                    currentSong.artistName || 'Unknown artist'
                  )}
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

        {/* Right: rating + DJ + favorite + volume */}
        <div className="flex min-w-0 flex-col items-end justify-center gap-1">
          <div className="flex items-center gap-2">
            <fieldset disabled={!hasTrack} aria-label="Rating" className="m-0 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-40">
              <StarRating
                rating={rating}
                onRate={hasTrack ? handleRate : () => {}}
              />
            </fieldset>
            <ItemContextMenu
              sections={[
                {
                  items: djModeItems.map((mode) => ({
                    id: mode.id,
                    label: mode.label,
                    icon: mode.icon,
                    active: autoDjMode === mode.id,
                    onClick: () => updatePreferences.mutate({ autoDjMode: mode.id }),
                  })),
                },
              ]}
            >
              <ControlButton
                onClick={handleToggleAutoDj}
                label={`Auto DJ: ${autoDjEnabled ? 'on' : 'off'}`}
                active={autoDjEnabled}
              >
                <Icon name="mdi-record-player" size={18} />
              </ControlButton>
            </ItemContextMenu>
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
              className="w-14"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
