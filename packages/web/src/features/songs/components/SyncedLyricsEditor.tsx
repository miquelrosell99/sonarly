import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyncedLyricLine } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { cn } from '../../../lib/cn.js';

const PX_PER_SECOND = 40;
const WHEEL_STEP_SECONDS = 0.5;
const COLLISION_THRESHOLD = 0.3;
const COLLISION_STEP = 0.1;
const VISIBLE_WINDOW_SECONDS = 12;

interface SyncedLyricsEditorProps {
  songId: string;
  title: string;
  artistName?: string;
  duration?: number;
  onClose: () => void;
  onSaved?: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export function SyncedLyricsEditor({ songId, title, artistName, duration, onClose, onSaved }: SyncedLyricsEditorProps) {
  const [lyrics, setLyrics] = useState<string>('');
  const [lines, setLines] = useState<SyncedLyricLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ index: number; startY: number; startTime: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    api<{ lyrics?: string; syncedLyrics?: SyncedLyricLine[] }>(`/songs/${songId}/lyrics`)
      .then((res) => {
        setLyrics(res.lyrics ?? '');
        setLines(res.syncedLyrics ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load lyrics'))
      .finally(() => setLoading(false));
  }, [songId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => setIsPlaying(false);
    const handleLoadedMetadata = () => {
      if (!duration && audio.duration) {
        // Use actual duration from audio if prop is missing.
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [duration]);

  const effectiveDuration = duration || audioRef.current?.duration || 0;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => setError('Could not play audio'));
      setIsPlaying(true);
    }
  };

  const seek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(time, effectiveDuration || time));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY > 0 ? 1 : -1;
    seek(currentTime + direction * WHEEL_STEP_SECONDS);
  };

  const handleDragStart = (index: number, e: React.PointerEvent) => {
    e.preventDefault();
    setDraggingIndex(index);
    dragStartRef.current = { index, startY: e.clientY, startTime: lines[index].time };

    const handleMove = (moveEvent: PointerEvent) => {
      if (!dragStartRef.current) return;
      const deltaPixels = moveEvent.clientY - dragStartRef.current.startY;
      const deltaSeconds = deltaPixels / PX_PER_SECOND;
      const newTime = Math.max(0, dragStartRef.current.startTime + deltaSeconds);
      setLines((prev) => prev.map((line, i) => (i === index ? { ...line, time: newTime } : line)));
    };

    const handleUp = () => {
      setDraggingIndex(null);
      dragStartRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const addLine = () => {
    let time = currentTime;
    while (lines.some((l) => Math.abs(l.time - time) < COLLISION_THRESHOLD)) {
      time += COLLISION_STEP;
      if (time > effectiveDuration && effectiveDuration > 0) break;
    }
    setLines((prev) => [...prev, { time, text: '' }].sort((a, b) => a.time - b.time));
  };

  const updateText = (index: number, text: string) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, text } : line)));
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/songs/${songId}/lyrics`, {
        method: 'PUT',
        body: JSON.stringify({ lyrics, syncedLyrics: lines }),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lyrics');
    } finally {
      setSaving(false);
    }
  };

  const visibleLines = useMemo(() => {
    return lines
      .map((line, index) => ({ line, index, offset: line.time - currentTime }))
      .filter(({ offset }) => Math.abs(offset) <= VISIBLE_WINDOW_SECONDS);
  }, [lines, currentTime]);

  const progressPercent = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-3xl bg-surface p-6 shadow-lg">Loading…</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onWheel={handleWheel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="synced-lyrics-title"
    >
      <audio ref={audioRef} preload="metadata" src={`/rest/stream.view?id=${songId}`} className="hidden" />

      <div className="flex h-full max-h-[800px] w-full max-w-3xl flex-col overflow-hidden border border-rule bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-rule px-6 py-4">
          <div>
            <h3 id="synced-lyrics-title" className="text-lg font-semibold">Synced Lyrics Editor</h3>
            <p className="text-sm text-fg-secondary">{title}{artistName ? ` • ${artistName}` : ''}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-secondary transition hover:text-fg-primary"
          >
            <Icon name="mdi-close" size={22} />
          </button>
        </div>

        <div className="flex items-center gap-4 border-b border-rule px-6 py-3">
          <Button onClick={togglePlay} className="gap-2" disabled={!audioRef.current && effectiveDuration === 0}>
            <Icon name={isPlaying ? 'mdi-pause' : 'mdi-play'} size={18} />
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
          <span className="tabular-nums text-sm text-fg-secondary">{formatTime(currentTime)} / {formatTime(effectiveDuration)}</span>
          <span className="ml-auto text-xs text-fg-secondary">Scroll to seek • Drag handle to retime</span>
        </div>

        <div className="relative flex-1 overflow-hidden bg-bg-primary">
          <div className="absolute left-6 top-6 bottom-6 w-10">
            <div className="relative h-full w-1.5 rounded-full bg-fg-primary/10">
              <div
                className="absolute left-0 right-0 top-0 rounded-full bg-accent"
                style={{ height: `${progressPercent}%` }}
              />
              <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-primary bg-accent shadow" />
            </div>
          </div>

          <div className="absolute inset-y-0 left-20 right-6">
            <div className="absolute left-0 right-0 top-1/2 h-px bg-accent/50" />
            {visibleLines.map(({ line, index, offset }) => {
              const top = `calc(50% + ${offset * PX_PER_SECOND}px)`;
              return (
                <div
                  key={index}
                  className="absolute left-0 right-0 flex items-center gap-3"
                  style={{ top, transform: 'translateY(-50%)' }}
                >
                  <button
                    type="button"
                    onPointerDown={(e) => handleDragStart(index, e)}
                    className={cn(
                      'flex h-5 w-5 shrink-0 cursor-ns-resize items-center justify-center rounded bg-accent text-bg-primary',
                      draggingIndex === index && 'cursor-grabbing'
                    )}
                    title="Drag to change time"
                  >
                    <span className="text-[8px]">⋮⋮</span>
                  </button>
                  <div className="h-px w-6 bg-fg-secondary/40" />
                  <div className="max-w-md flex-1 rounded-md border border-rule bg-surface px-3 py-2 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-fg-secondary tabular-nums">{formatTime(line.time)}</span>
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        className="text-fg-secondary transition hover:text-danger"
                        aria-label="Remove line"
                      >
                        <Icon name="mdi-close" size={14} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={line.text}
                      onChange={(e) => updateText(index, e.target.value)}
                      className="mt-1 w-full bg-transparent text-sm outline-none"
                      placeholder="Lyric line"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <p className="px-6 py-2 text-sm text-danger">{error}</p>}

        <div className="flex items-center justify-between border-t border-rule px-6 py-4">
          <Button onClick={addLine} className="gap-2">
            <Icon name="mdi-plus" size={18} />
            Add chop at current time
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
