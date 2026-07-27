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
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
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
  const [mode, setMode] = useState<'dynamic' | 'static'>('dynamic');
  const [editorOpen, setEditorOpen] = useState(false);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
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

  const activeIndex = useMemo(() => {
    if (!syncedLyrics || mode !== 'dynamic') return -1;
    return findActiveLine(syncedLyrics, currentTime);
  }, [syncedLyrics, currentTime, mode]);

  useEffect(() => {
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
  }, [activeIndex, mode]);

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
        {editorOpen && currentSong && (
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
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setMode('dynamic')}
          aria-label="Dynamic lyrics"
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
          className={cn(
            'inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium transition',
            mode === 'static' ? 'bg-accent text-bg-primary' : 'text-fg-secondary hover:bg-surface-hover'
          )}
        >
          <Icon name="mdi-text" size={14} />
          Static
        </button>
      </div>

      {mode === 'dynamic' && syncedLyrics && syncedLyrics.length > 0 ? (
        <div ref={containerRef} className="flex-1 overflow-y-auto pr-2">
          <div className="space-y-4 py-8">
            {syncedLyrics.map((line, index) => {
              const isActive = index === activeIndex;
              return (
                <div
                  key={index}
                  ref={(el) => { lineRefs.current[index] = el; }}
                  className={cn(
                    'text-center text-lg transition duration-300',
                    isActive ? 'scale-105 font-semibold text-accent' : 'text-fg-secondary/60'
                  )}
                >
                  {line.text}
                </div>
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
          {editorOpen && currentSong && (
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
          )}
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-y-auto whitespace-pre-wrap px-2 text-center text-fg-primary">
          {plainLyrics || syncedLyrics?.map((line) => line.text).join('\n')}
        </div>
      )}
    </div>
  );
}
