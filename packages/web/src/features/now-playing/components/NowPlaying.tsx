import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { AutoDjMode, User } from '@sonarly/shared';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { ControlButton } from '../../../components/PlayerControls.js';
import { useNowPlaying, type NowPlayingTab } from '../stores/nowPlayingStore.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useDominantColor } from '../../../hooks/useDominantColor.js';
import { useSongInteraction } from '../../../hooks/useSongInteraction.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { NowPlayingCover } from './NowPlayingCover.js';
import { TransportControls } from './TransportControls.js';
import { QueuePanel } from './QueuePanel.js';
import { LyricsPanel } from './LyricsPanel.js';

interface NowPlayingProps {
  user: User;
}

function GradientBackground({ coverArtUrl }: { coverArtUrl?: string }) {
  const dominantColor = useDominantColor(coverArtUrl);
  return (
    <div
      className="absolute inset-0 transition-colors duration-700"
      style={{
        background: dominantColor
          ? `radial-gradient(circle at 30% 40%, ${dominantColor} 0%, transparent 50%), radial-gradient(circle at 80% 20%, ${dominantColor} 0%, transparent 40%), hsl(var(--bg-primary))`
          : 'hsl(var(--bg-primary))',
      }}
    />
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
  id,
  ariaControls,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
  id: string;
  ariaControls: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      onClick={onClick}
      aria-selected={active}
      aria-controls={ariaControls}
      tabIndex={active ? 0 : -1}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition',
        active ? 'bg-accent text-bg-primary' : 'text-fg-secondary hover:bg-surface-hover'
      )}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

export function NowPlaying({ user }: NowPlayingProps) {
  const isOpen = useNowPlaying((state) => state.isOpen);
  const activeTab = useNowPlaying((state) => state.activeTab);
  const close = useNowPlaying((state) => state.close);
  const setActiveTab = useNowPlaying((state) => state.setActiveTab);

  const currentSong = usePlayer((state) => state.currentSong);
  const coverArtUrl = currentSong?.coverArt ? `/api/cover-art/${currentSong.coverArt}` : undefined;
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);

  const { starred, rating, setFavorite, setRating } = useSongInteraction(
    currentSong?.id,
    { starred: currentSong?.starred, rating: currentSong?.rating },
  );

  const { data: preferences } = usePreferences();
  const autoDjEnabled = preferences?.autoDjEnabled ?? false;
  const autoDjMode = preferences?.autoDjMode ?? 'smart';
  const updatePreferences = useUpdatePreferences();

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

  const [closing, setClosing] = useState(false);
  const wasOpenRef = useRef(isOpen);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open and restore it on close.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  const handleTabListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const tabs: NowPlayingTab[] = ['queue', 'lyrics'];
    const currentIndex = tabs.indexOf(activeTab);
    const nextIndex =
      e.key === 'ArrowRight'
        ? (currentIndex + 1) % tabs.length
        : (currentIndex - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab);
    document.getElementById(`now-playing-tab-${nextTab}`)?.focus();
  };

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
    } else if (wasOpenRef.current) {
      const prefersReducedMotion =
        typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) {
        setClosing(false);
      } else {
        setClosing(true);
        const timer = setTimeout(() => setClosing(false), 250);
        return () => clearTimeout(timer);
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen && currentSong) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, currentSong]);

  if (!isOpen && !closing) return null;
  if (!currentSong) return null;

  const panelId = `now-playing-panel-${activeTab}`;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      tabIndex={-1}
      className={cn(
        'fixed inset-0 z-50 flex outline-none',
        closing ? 'now-playing-exit' : 'now-playing-enter'
      )}
    >
      {/* Gradient background */}
      <GradientBackground coverArtUrl={coverArtUrl} />
      <div className="absolute inset-0 bg-bg-primary/90 backdrop-blur-xl" />

      {/* Close button */}
      <button
        type="button"
        onClick={close}
        aria-label="Close Now Playing"
        className="absolute left-6 top-6 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="mdi-chevron-down" size={24} />
      </button>

      {/* Content */}
      <div
        className={cn(
          'relative z-0 mx-auto flex h-full min-h-0 w-full max-w-7xl items-center p-6 md:p-12',
          closing ? 'now-playing-content-exit' : 'now-playing-content'
        )}
      >
        <div className="grid h-full min-h-0 w-full grid-cols-1 gap-8 md:grid-cols-[1fr_1.2fr] md:gap-12">
          {/* Left: cover + metadata */}
          <div className="flex flex-col items-center justify-center gap-6 text-center">
            <NowPlayingCover
              coverArt={currentSong.albumCoverArt ?? currentSong.coverArt}
              alt={`Cover art for ${currentSong.title}`}
            />
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-bold text-fg-primary">
                <ExplicitTitle
                  explicit={currentSong.explicit}
                  blur={user.blurExplicitTitles === true}
                >
                  <Link
                    href={`/tracks/${currentSong.id}`}
                    onClick={() => close()}
                    className="transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {currentSong.title}
                  </Link>
                </ExplicitTitle>
              </h2>
              <p className="text-lg text-fg-secondary">
                {currentSong.artistId ? (
                  <Link
                    href={`/artists/${currentSong.artistId}`}
                    onClick={() => close()}
                    className="transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {currentSong.artistName || 'Unknown artist'}
                  </Link>
                ) : (
                  currentSong.artistName || 'Unknown artist'
                )}
              </p>
              {(currentSong.albumName || currentSong.year) && (
                <p className="text-sm text-fg-secondary/70">
                  {currentSong.albumId && currentSong.albumName ? (
                    <Link
                      href={`/albums/${currentSong.albumId}`}
                      onClick={() => close()}
                      className="transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {currentSong.albumName}
                    </Link>
                  ) : (
                    currentSong.albumName
                  )}
                  {currentSong.albumName && currentSong.year && (
                    <span aria-hidden="true" className="mx-1.5">
                      ·
                    </span>
                  )}
                  {currentSong.year && (
                    <Link
                      href={`/years/${currentSong.year}`}
                      onClick={() => close()}
                      className="transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {currentSong.year}
                    </Link>
                  )}
                </p>
              )}
            </div>
            <FavoriteRatingGroup
              starred={starred}
              onToggleFavorite={() => handleFavorite(!starred)}
              rating={rating}
              onRate={handleRate}
            />
            <TransportControls />
          </div>

          {/* Right: card with tabs */}
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-rule/50 bg-surface/80 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-rule/50 px-4 py-3">
              <div
                className="flex items-center gap-2"
                role="tablist"
                aria-label="Now playing panels"
                onKeyDown={handleTabListKeyDown}
              >
                <TabButton
                  id="now-playing-tab-queue"
                  active={activeTab === 'queue'}
                  onClick={() => setActiveTab('queue')}
                  label="Queue"
                  icon="mdi-playlist-music"
                  ariaControls="now-playing-panel-queue"
                />
                <TabButton
                  id="now-playing-tab-lyrics"
                  active={activeTab === 'lyrics'}
                  onClick={() => setActiveTab('lyrics')}
                  label="Lyrics"
                  icon="mdi-text"
                  ariaControls="now-playing-panel-lyrics"
                />
              </div>
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
                anchorToTrigger
                placement="top-end"
              >
                <ControlButton
                  onClick={handleToggleAutoDj}
                  label={`Auto DJ: ${autoDjEnabled ? 'on' : 'off'}`}
                  active={autoDjEnabled}
                  className="h-11 w-auto gap-1.5 px-2.5 text-xs font-medium"
                >
                  <Icon name="mdi-record-player" size={16} />
                  Auto DJ
                </ControlButton>
              </ItemContextMenu>
            </div>
            <div
              id={panelId}
              role="tabpanel"
              aria-labelledby={`now-playing-tab-${activeTab}`}
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4"
            >
              {activeTab === 'queue' ? (
                <QueuePanel user={user} />
              ) : (
                <LyricsPanel user={user} activeTab={activeTab} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
