import { useEffect, useRef } from 'react';
import type { User } from '@sonarly/shared';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { useNowPlaying } from '../stores/nowPlayingStore.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useDominantColor } from '../../../hooks/useDominantColor.js';
import { NowPlayingCover } from './NowPlayingCover.js';
import { TransportControls } from './TransportControls.js';
import { QueuePanel } from './QueuePanel.js';
import { LyricsPanel } from './LyricsPanel.js';

interface NowPlayingProps {
  user: User;
}

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition',
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
  const dominantColor = useDominantColor(coverArtUrl);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen || !currentSong) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      className="now-playing-enter fixed inset-0 z-50 flex"
    >
      {/* Gradient background */}
      <div
        className="absolute inset-0 transition-colors duration-700"
        style={{
          background: dominantColor
            ? `radial-gradient(circle at 30% 40%, ${dominantColor} 0%, transparent 50%), radial-gradient(circle at 80% 20%, ${dominantColor} 0%, transparent 40%), hsl(var(--bg-primary))`
            : 'hsl(var(--bg-primary))',
        }}
      />
      <div className="absolute inset-0 bg-bg-primary/90 backdrop-blur-xl" />

      {/* Close button */}
      <button
        type="button"
        onClick={close}
        aria-label="Close Now Playing"
        className="absolute right-6 top-6 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="mdi-chevron-down" size={24} />
      </button>

      {/* Content */}
      <div className="now-playing-content relative z-0 mx-auto flex w-full max-w-7xl items-center p-6 md:p-12">
        <div className="grid w-full grid-cols-1 gap-8 md:grid-cols-[1fr_1.2fr] md:gap-12">
          {/* Left: cover + metadata */}
          <div className="flex flex-col items-center justify-center gap-6 text-center">
            <NowPlayingCover
              coverArt={currentSong.coverArt}
              alt={`Cover art for ${currentSong.title}`}
            />
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-fg-primary">{currentSong.title}</h2>
              <p className="text-lg text-fg-secondary">{currentSong.artistName || 'Unknown artist'}</p>
              {currentSong.albumName && (
                <p className="text-sm text-fg-secondary/70">{currentSong.albumName}</p>
              )}
              <div className="flex items-center justify-center gap-2 pt-1 text-xs text-fg-secondary">
                {currentSong.year && <span>{currentSong.year}</span>}
                {currentSong.genre && <span>• {currentSong.genre}</span>}
              </div>
            </div>
            <TransportControls />
          </div>

          {/* Right: card with tabs */}
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-rule/50 bg-surface/80 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-rule/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <TabButton
                  active={activeTab === 'queue'}
                  onClick={() => setActiveTab('queue')}
                  label="Queue"
                  icon="mdi-playlist-music"
                />
                <TabButton
                  active={activeTab === 'lyrics'}
                  onClick={() => setActiveTab('lyrics')}
                  label="Lyrics"
                  icon="mdi-text"
                />
              </div>
            </div>
            <div className="flex-1 min-h-0 p-4">
              {activeTab === 'queue' ? <QueuePanel user={user} /> : <LyricsPanel user={user} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
