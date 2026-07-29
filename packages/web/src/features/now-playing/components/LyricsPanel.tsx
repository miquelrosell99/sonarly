import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@sonarly/shared';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { api } from '../../../api.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { SyncedLyricsEditor } from '../../songs/index.js';
import type { NowPlayingTab } from '../stores/nowPlayingStore.js';

interface LyricsPanelProps {
  user: User;
  activeTab?: NowPlayingTab;
}

function findActiveLine(lines: { time: number; text: string }[], currentTime: number): number {
  if (lines.length === 0 || lines[0].time > currentTime) return -1;
  let index = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].time <= currentTime) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

export function LyricsPanel({ user, activeTab = 'lyrics' }: LyricsPanelProps) {
  const currentSong = usePlayer((state) => state.currentSong);
  const currentTime = usePlayer((state) => state.currentTime);
  const seek = usePlayer((state) => state.seek);
  const [mode, setMode] = useState<'dynamic' | 'static'>('dynamic');
  const [autoScroll, setAutoScroll] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const songId = currentSong?.id;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['lyrics', songId],
    queryFn: async () => {
      const res = await api<{ lyrics?: string; syncedLyrics?: { time: number; text: string }[] }>(`/songs/${songId}/lyrics`);
      return res;
    },
    enabled: activeTab === 'lyrics' && !!songId,
    staleTime: 60_000,
  });

  const syncedLyrics = data?.syncedLyrics;
  const plainLyrics = data?.lyrics;

  const editorModal = editorOpen && currentSong ? (
    <SyncedLyricsEditor
      songId={currentSong.id}
      title={currentSong.title}
      artistName={currentSong.artistName}
      duration={currentSong.duration}
      onClose={() => setEditorOpen(false)}
      onSaved={() => {
        setEditorOpen(false);
        if (songId) {
          queryClient.invalidateQueries({ queryKey: ['lyrics', songId] });
        }
      }}
    />
  ) : null;

  const lyricsMaskStyle = {
    maskImage: 'linear-gradient(to bottom, transparent, black 1rem, black calc(100% - 1rem), transparent)',
    WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 1rem, black calc(100% - 1rem), transparent)',
  };

  const activeIndex = useMemo(() => {
    if (!syncedLyrics || mode !== 'dynamic') return -1;
    return findActiveLine(syncedLyrics, currentTime);
  }, [syncedLyrics, currentTime, mode]);

  const scrollActiveLineToCenter = () => {
    if (mode !== 'dynamic' || activeIndex < 0) return;
    const line = lineRefs.current[activeIndex];
    const container = containerRef.current;
    if (line && container) {
      const containerRect = container.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      const desired = container.scrollTop + lineRect.top - containerRect.top - containerRect.height / 2 + lineRect.height / 2;
      if (typeof container.scrollTo === 'function') {
        const prefersReducedMotion =
          typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        container.scrollTo({ top: desired, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      }
    }
  };

  useEffect(() => {
    if (!autoScroll) return;
    scrollActiveLineToCenter();
  }, [activeIndex, mode, autoScroll]);

  useEffect(() => {
    if (!autoScroll) return;
    scrollActiveLineToCenter();
  }, [autoScroll]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-fg-secondary">
        <Icon name="mdi-clock-outline" size={24} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-secondary">
        <p className="text-sm">Could not load lyrics.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="btn-ghost text-xs"
        >
          Retry
        </button>
      </div>
    );
  }

  const hasLyrics = !!(syncedLyrics?.length || plainLyrics);

  if (!hasLyrics) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-secondary">
        <Icon name="mdi-text" size={48} />
        <p className="text-sm">No lyrics for this track.</p>
        {user.isAdmin && (
          <button type="button" onClick={() => setEditorOpen(true)} className="text-sm text-accent hover:underline">
            Add lyrics
          </button>
        )}
        {editorModal}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {user.isAdmin && (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              aria-label="Edit lyrics"
              className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-fg-secondary transition hover:bg-surface-hover"
            >
              <Icon name="mdi-pencil" size={14} />
              Edit lyrics
            </button>
          )}
          {mode === 'dynamic' && (
            <button
              type="button"
              onClick={() => setAutoScroll((prev) => !prev)}
              aria-label="Auto-scroll lyrics"
              aria-pressed={autoScroll}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-full transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
                autoScroll
                  ? 'bg-accent/15 text-accent hover:bg-accent/25'
                  : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary'
              )}
            >
              <Icon name="mdi-arrow-collapse-vertical" size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('dynamic')}
            aria-label="Dynamic lyrics"
            aria-pressed={mode === 'dynamic'}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium transition',
              mode === 'dynamic' ? 'bg-accent text-bg-primary' : 'text-fg-secondary hover:bg-surface-hover'
            )}
          >
            <Icon name="mdi-sync" size={14} />
            Dynamic
          </button>
          <button
            type="button"
            onClick={() => setMode('static')}
            aria-label="Static lyrics"
            aria-pressed={mode === 'static'}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium transition',
              mode === 'static' ? 'bg-accent text-bg-primary' : 'text-fg-secondary hover:bg-surface-hover'
            )}
          >
            <Icon name="mdi-text" size={14} />
            Static
          </button>
        </div>
      </div>

      {mode === 'dynamic' && syncedLyrics && syncedLyrics.length > 0 ? (
        <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden pr-2" style={lyricsMaskStyle}>
          <div className="space-y-4 py-8">
            {syncedLyrics.map((line, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={index}
                  ref={(el) => { lineRefs.current[index] = el; }}
                  type="button"
                  onClick={() => seek(line.time)}
                  className={cn(
                    'block w-full break-words text-center text-lg transition duration-300',
                    'cursor-pointer hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
                    isActive ? 'scale-105 font-semibold text-accent' : 'text-fg-secondary/60'
                  )}
                >
                  {line.text}
                </button>
              );
            })}
          </div>
        </div>
      ) : mode === 'dynamic' && plainLyrics ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-secondary">
          <p className="text-sm">This track has plain lyrics only.</p>
          {user.isAdmin && (
            <button type="button" onClick={() => setEditorOpen(true)} className="text-sm text-accent hover:underline">
              Sync lyrics to enable dynamic mode
            </button>
          )}
          {editorModal}
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words px-2 text-center text-fg-primary" style={lyricsMaskStyle}>
          {syncedLyrics ? syncedLyrics.map((line) => line.text).join('\n') : plainLyrics}
        </div>
      )}
      {editorModal}
    </div>
  );
}
