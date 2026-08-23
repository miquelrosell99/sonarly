import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { User } from '@sonarly/shared';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { useNowPlaying, type NowPlayingTab } from '../stores/nowPlayingStore.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useDominantColor } from '../../../hooks/useDominantColor.js';
import { useSongInteraction } from '../../../hooks/useSongInteraction.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active
          ? 'bg-accent text-bg-primary shadow-sm'
          : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary'
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
  const { notify } = useNotification();

  const currentSong = usePlayer((state) => state.currentSong);
  const queueContext = usePlayer((state) => state.queueContext);
  const coverArtUrl = currentSong?.coverArt ? `/api/cover-art/${currentSong.coverArt}` : undefined;
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);

  const { starred, rating, setFavorite, setRating } = useSongInteraction(
    currentSong?.id,
    { starred: currentSong?.starred, rating: currentSong?.rating },
  );

  const handleFavorite = async (nextStarred: boolean) => {
    await setFavorite(nextStarred);
    updateCurrentSong({ starred: nextStarred });
  };

  const handleRate = async (nextRating?: number) => {
    await setRating(nextRating);
    updateCurrentSong({ rating: nextRating });
  };

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

      {/* Copy deep link (/now-playing/<context>/<contextId>/<songId>) when the queue came from a playlist or album */}
      {queueContext && currentSong && (
        <button
          type="button"
          onClick={async () => {
            const url = `${window.location.origin}/now-playing/${queueContext.type}/${queueContext.id}/${currentSong.id}`;
            try {
              await navigator.clipboard.writeText(url);
              notify('Link copied', 'success');
            } catch {
              notify('Could not copy link', 'error');
            }
          }}
          aria-label="Copy link to this track in context"
          title="Copy link to this track in context"
          className="absolute right-6 top-6 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="mdi-link-variant" size={20} />
        </button>
      )}

      {/* Content: stacked and scrollable on narrow screens, two-column hero on wide */}
      <div
        className={cn(
          'relative z-0 h-full min-h-0 w-full overflow-y-auto',
          closing ? 'now-playing-content-exit' : 'now-playing-content'
        )}
      >
        <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-6 px-4 pb-8 pt-20 sm:gap-8 sm:px-6 md:h-full md:min-h-0 md:max-w-7xl md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-center md:gap-12 md:p-12">
          {/* Left: cover + metadata */}
          <div className="flex min-w-0 flex-col items-center gap-5 text-center md:justify-center md:gap-6">
            <NowPlayingCover
              coverArt={currentSong.albumCoverArt ?? currentSong.coverArt}
              alt={`Cover art for ${currentSong.title}`}
              className="max-w-[min(62vw,240px)] sm:max-w-[300px] md:max-w-[min(420px,44vh)]"
            />
            <div className="w-full min-w-0 space-y-1.5">
              <h2
                className="line-clamp-2 break-words font-display text-2xl font-bold leading-tight text-fg-primary sm:text-3xl"
                title={currentSong.title}
              >
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
              <p className="truncate text-lg text-fg-secondary" title={currentSong.artistName || 'Unknown artist'}>
                {currentSong.artistId ? (
                  <Link
                    href={`/artists/${currentSong.artistId}`}
                    onClick={() => close()}
                    className="transition hover:text-fg-primary hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {currentSong.artistName || 'Unknown artist'}
                  </Link>
                ) : (
                  currentSong.artistName || 'Unknown artist'
                )}
              </p>
              {(currentSong.albumName || currentSong.year) && (
                <p
                  className="truncate text-sm text-fg-secondary/70"
                  title={[currentSong.albumName, currentSong.year].filter(Boolean).join(' · ')}
                >
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
          <div className="flex h-[58vh] min-h-[320px] min-w-0 flex-col overflow-hidden rounded-2xl border border-rule/50 bg-surface/80 backdrop-blur-xl md:h-full md:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule/50 px-3 py-2.5 sm:px-4">
              <div
                className="flex items-center gap-1 rounded-full border border-rule/50 bg-bg-primary/60 p-1"
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
