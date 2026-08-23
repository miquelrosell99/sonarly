import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LrcLibMatch, LrcLibSearchResult, SyncedLyricLine } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Input } from '../../../components/ui/Input.js';
import { Modal } from '../../../components/ui/Modal.js';
import { PageState } from '../../../components/PageState.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { cn } from '../../../lib/cn.js';

const PX_PER_SECOND = 40;
const WHEEL_STEP_SECONDS = 0.5;
const MAX_PEAK_BUCKETS = 2000;

interface SyncedLyricsEditorProps {
  songId: string;
  title: string;
  artistName?: string;
  duration?: number;
  onClose: () => void;
  onSaved?: () => void;
}

interface EditLine {
  id: number;
  time: number;
  text: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

function sortByTime(lines: EditLine[]): EditLine[] {
  return [...lines].sort((a, b) => a.time - b.time);
}

// Session-level cache of decoded peak data per song (null = decoding failed,
// cached so we don't retry a broken decode on every editor open).
const peaksCache = new Map<string, Promise<Float32Array | null>>();

function computePeaks(songId: string): Promise<Float32Array | null> {
  const cached = peaksCache.get(songId);
  if (cached) return cached;
  const promise = (async (): Promise<Float32Array | null> => {
    try {
      const AudioContextCtor = window.AudioContext;
      if (!AudioContextCtor) return null;
      const res = await fetch(`/rest/stream.view?id=${encodeURIComponent(songId)}`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const buffer = await res.arrayBuffer();
      const context = new AudioContextCtor();
      let audio: AudioBuffer;
      try {
        audio = await context.decodeAudioData(buffer);
      } finally {
        context.close().catch(() => {});
      }
      const data = audio.getChannelData(0);
      if (data.length === 0) return null;
      const buckets = Math.min(MAX_PEAK_BUCKETS, data.length);
      const bucketSize = Math.max(1, Math.floor(data.length / buckets));
      const peaks = new Float32Array(buckets);
      let max = 0;
      for (let b = 0; b < buckets; b += 1) {
        const start = b * bucketSize;
        let peak = 0;
        for (let i = start; i < Math.min(start + bucketSize, data.length); i += 8) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
        peaks[b] = peak;
        if (peak > max) max = peak;
      }
      if (max > 0) {
        for (let b = 0; b < buckets; b += 1) peaks[b] /= max;
      }
      return peaks;
    } catch {
      return null;
    }
  })();
  peaksCache.set(songId, promise);
  return promise;
}

export function SyncedLyricsEditor({ songId, title, artistName, duration, onClose, onSaved }: SyncedLyricsEditorProps) {
  const [lyrics, setLyrics] = useState<string>('');
  const [lines, setLines] = useState<EditLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [peaksLoading, setPeaksLoading] = useState(true);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [fetching, setFetching] = useState(false);
  const [pendingMatch, setPendingMatch] = useState<LrcLibMatch | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const nextIdRef = useRef(1);
  const suppressClickRef = useRef(false);

  // Mirrors for handlers registered once (wheel, keyboard, pointer drags).
  const linesRef = useRef(lines);
  const currentTimeRef = useRef(currentTime);
  const modalOpenRef = useRef(false);
  linesRef.current = lines;
  currentTimeRef.current = currentTime;
  modalOpenRef.current = editId !== null || pendingMatch !== null;

  const effectiveDuration = duration || audioDuration || 0;
  const effectiveDurationRef = useRef(effectiveDuration);
  effectiveDurationRef.current = effectiveDuration;

  const toEditLines = (synced: SyncedLyricLine[]): EditLine[] =>
    sortByTime(synced.map((l) => ({ id: nextIdRef.current++, time: l.time, text: l.text })));

  // Load existing lyrics.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    api<{ lyrics?: string; syncedLyrics?: SyncedLyricLine[] }>(`/songs/${songId}/lyrics`)
      .then((res) => {
        setLyrics(res.lyrics ?? '');
        const loaded = toEditLines(res.syncedLyrics ?? []);
        setLines(loaded);
        // Start the tape just before the first line so existing lyrics are
        // visible on open instead of an empty viewport at 0:00.
        if (loaded.length > 0) {
          const start = Math.max(0, loaded[0].time - 2);
          setCurrentTime(start);
          if (audioRef.current) audioRef.current.currentTime = start;
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load lyrics'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  // Decode the waveform peaks (cached per song; null falls back to a gradient track).
  useEffect(() => {
    let cancelled = false;
    setPeaksLoading(true);
    computePeaks(songId).then((result) => {
      if (cancelled) return;
      setPeaks(result);
      setPeaksLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  const ready = !loading && !loadError;

  // Measure the waveform viewport.
  useEffect(() => {
    if (!ready) return;
    const el = areaRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      setViewport({ width: el.clientWidth || 360, height: el.clientHeight || 600 });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  const seek = (time: number) => {
    const clamped = Math.max(0, effectiveDurationRef.current > 0 ? Math.min(time, effectiveDurationRef.current) : time);
    const audio = audioRef.current;
    if (audio) audio.currentTime = clamped;
    setCurrentTime(clamped);
  };
  const seekRef = useRef(seek);
  seekRef.current = seek;

  // Focus trap + Escape, cribbed from components/ui/Modal. Suspended while a
  // nested modal (line editor, LRCLIB confirm) is open.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) {
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? dialog).focus();
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (modalOpenRef.current) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const currentDialog = dialogRef.current;
      if (!currentDialog) return;
      const focusable = Array.from(currentDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !currentDialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !currentDialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [onClose]);

  // Wheel-to-seek on the waveform (non-passive so we can preventDefault).
  useEffect(() => {
    if (!ready) return;
    const el = areaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      seekRef.current(currentTimeRef.current + (e.deltaY > 0 ? WHEEL_STEP_SECONDS : -WHEEL_STEP_SECONDS));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [ready]);

  // Audio element wiring; smooth rAF tracking while playing (reduced-motion
  // users get the coarser timeupdate cadence instead of a JS animation loop).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => setIsPlaying(false);
    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) setAudioDuration(audio.duration);
    };
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || prefersReducedMotion()) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setCurrentTime(audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // Paint the vertical waveform for the current window.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = viewport;
    if (width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const columnWidth = width < 640 ? 64 : 96;
    const centerY = height / 2;
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg-primary').trim() || '0 0% 100%';

    if (peaks && effectiveDuration > 0) {
      const buckets = peaks.length;
      for (let y = 0; y < height; y += 2) {
        const t = currentTime + (y - centerY) / PX_PER_SECOND;
        if (t < 0 || t >= effectiveDuration) continue;
        const amp = peaks[Math.min(buckets - 1, Math.floor((t / effectiveDuration) * buckets))];
        const half = Math.max(1, amp * (columnWidth / 2 - 6));
        ctx.fillStyle = `hsl(${fg} / ${t <= currentTime ? 0.32 : 0.18})`;
        ctx.fillRect(columnWidth / 2 - half, y, half * 2, 1.5);
      }
    } else {
      // Fallback track when decoding is unavailable.
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, `hsl(${fg} / 0.03)`);
      gradient.addColorStop(0.5, `hsl(${fg} / 0.1)`);
      gradient.addColorStop(1, `hsl(${fg} / 0.03)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(columnWidth * 0.2, 0, columnWidth * 0.6, height);
    }
  }, [currentTime, peaks, viewport, effectiveDuration]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => setActionError('Could not play audio'));
      setIsPlaying(true);
    }
  };

  const updateLineTime = (id: number, time: number) => {
    setLines((prev) => sortByTime(prev.map((l) => (l.id === id ? { ...l, time: Math.max(0, time) } : l))));
  };

  const openEdit = (id: number) => {
    const line = linesRef.current.find((l) => l.id === id);
    setEditText(line?.text ?? '');
    setEditId(id);
  };

  const closeEdit = () => setEditId(null);

  const saveEdit = () => {
    if (editId === null) return;
    setLines((prev) => prev.map((l) => (l.id === editId ? { ...l, text: editText } : l)));
    setEditId(null);
  };

  const deleteEdit = () => {
    if (editId === null) return;
    setLines((prev) => prev.filter((l) => l.id !== editId));
    setEditId(null);
  };

  const addLineAtCenter = () => {
    const id = nextIdRef.current++;
    const time = currentTimeRef.current;
    setLines((prev) => sortByTime([...prev, { id, time, text: '' }]));
    setEditText('');
    setEditId(id);
  };

  // Drag the whole tape: dragging the background scrolls the waveform under
  // the pinned center line.
  const handleAreaPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-pill]')) return;
    e.preventDefault();
    const startY = e.clientY;
    const startTime = currentTimeRef.current;
    const handleMove = (ev: PointerEvent) => {
      seekRef.current(startTime - (ev.clientY - startY) / PX_PER_SECOND);
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleAreaKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      seek(currentTime + 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(currentTime - 1);
    }
  };

  // Pill drag: vertical drag retimes live; a plain click opens the editor modal.
  const handlePillPointerDown = (line: EditLine) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const drag = { startY: e.clientY, startTime: line.time, moved: false };
    const handleMove = (ev: PointerEvent) => {
      const dy = ev.clientY - drag.startY;
      if (Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        setDraggingId(line.id);
        updateLineTime(line.id, drag.startTime + dy / PX_PER_SECOND);
      }
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setDraggingId(null);
      if (drag.moved) suppressClickRef.current = true;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handlePillClick = (line: EditLine) => () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    openEdit(line.id);
  };

  const handlePillKeyDown = (line: EditLine) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.5 : 0.1;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateLineTime(line.id, line.time - step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateLineTime(line.id, line.time + step);
    }
  };

  const applyMatch = (match: LrcLibMatch) => {
    setActionError(null);
    if (match.syncedLyrics && match.syncedLyrics.length > 0) {
      setLines(toEditLines(match.syncedLyrics));
      if (match.lyrics) setLyrics(match.lyrics);
    } else if (match.lyrics) {
      setLyrics(match.lyrics);
    }
    setPendingMatch(null);
  };

  const fetchFromLrcLib = async () => {
    setFetching(true);
    setActionError(null);
    try {
      const params = new URLSearchParams();
      params.set('title', title);
      if (artistName) params.set('artist', artistName);
      if (duration !== undefined && Number.isFinite(duration)) params.set('duration', String(duration));
      const result = await api<LrcLibSearchResult>(`/lrclib/search?${params.toString()}`);
      const best = result.matches[0];
      if (!best || ((!best.syncedLyrics || best.syncedLyrics.length === 0) && !best.lyrics)) {
        setActionError('No LRCLIB match with lyrics found.');
        return;
      }
      if (lines.length > 0 || lyrics.trim().length > 0) {
        setPendingMatch(best);
      } else {
        applyMatch(best);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to fetch LRCLIB lyrics');
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await api(`/songs/${songId}/lyrics`, {
        method: 'PUT',
        body: JSON.stringify({
          lyrics,
          syncedLyrics: lines.map(({ time, text }) => ({ time, text })),
        }),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save lyrics');
    } finally {
      setSaving(false);
    }
  };

  const centerY = viewport.height / 2;
  const editLine = editId !== null ? lines.find((l) => l.id === editId) : undefined;
  const visibleLines = lines.filter(
    (line) => Math.abs(line.time - currentTime) * PX_PER_SECOND <= centerY + 80,
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-black/70 sm:items-center sm:justify-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <audio ref={audioRef} preload="metadata" src={`/rest/stream.view?id=${songId}`} className="hidden" />

      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="synced-lyrics-title"
        className="flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl outline-none sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-rule"
      >
        <div className="flex items-center justify-between gap-2 border-b border-rule/60 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 id="synced-lyrics-title" className="font-display text-lg font-semibold">Synced Lyrics</h3>
            <p className="truncate text-sm text-fg-secondary">{title}{artistName ? ` • ${artistName}` : ''}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={fetchFromLrcLib}
              disabled={fetching}
              aria-label="Fetch lyrics from LRCLIB"
              title="Fetch lyrics from LRCLIB"
              className="flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <Icon
                name={fetching ? 'mdi-loading' : 'mdi-cloud-download-outline'}
                size={20}
                className={fetching ? 'animate-spin motion-reduce:animate-none' : undefined}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon name="mdi-close" size={20} />
            </button>
          </div>
        </div>

        <PageState loading={loading} error={loadError} className="flex-1 justify-center">
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Waveform viewport: tape scrolls under the pinned center line */}
            <div
              ref={areaRef}
              role="slider"
              tabIndex={0}
              aria-label="Seek position"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={Math.round(effectiveDuration)}
              aria-valuenow={Math.round(currentTime)}
              aria-valuetext={formatTime(currentTime)}
              onPointerDown={handleAreaPointerDown}
              onKeyDown={handleAreaKeyDown}
              className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />

              {/* Pinned center line + mono time */}
              <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0 top-1/2 h-px bg-accent" />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-surface/80 px-1.5 py-0.5 font-mono text-xs tabular-nums text-accent"
              >
                {formatTime(currentTime)}
              </div>

              {peaksLoading && (
                <div
                  role="status"
                  className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-rule bg-surface px-3 py-1 text-xs text-fg-secondary"
                >
                  <Icon name="mdi-loading" size={14} className="animate-spin motion-reduce:animate-none" />
                  Analyzing waveform…
                </div>
              )}

              {/* Lyric pills anchored to their timestamps */}
              <div className="pointer-events-none absolute inset-y-0 left-16 right-2 sm:left-24 sm:right-4">
                {visibleLines.map((line) => {
                  const y = centerY + (line.time - currentTime) * PX_PER_SECOND;
                  const nearCenter = Math.abs(line.time - currentTime) < 0.25;
                  return (
                    <div
                      key={line.id}
                      className="pointer-events-auto absolute left-0 flex w-full items-center"
                      style={{ top: y, transform: 'translateY(-50%)' }}
                    >
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                      <span aria-hidden="true" className="h-px w-3 shrink-0 bg-accent/60 sm:w-5" />
                      <button
                        data-pill
                        type="button"
                        onPointerDown={handlePillPointerDown(line)}
                        onClick={handlePillClick(line)}
                        onKeyDown={handlePillKeyDown(line)}
                        aria-label={`Edit line: ${line.text || '(empty)'} at ${formatTime(line.time)}`}
                        title="Click to edit, drag to retime, arrow keys to nudge"
                        className={cn(
                          'flex h-11 min-w-0 max-w-full cursor-ns-resize items-center rounded-full border bg-surface px-3 text-sm shadow-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                          nearCenter ? 'border-accent' : 'border-rule hover:border-fg-secondary',
                          draggingId === line.id && 'border-accent ring-2 ring-accent',
                        )}
                      >
                        <span
                          className={cn(
                            'truncate',
                            draggingId === line.id
                              ? 'font-mono text-xs tabular-nums text-accent'
                              : line.text
                                ? 'text-fg-primary'
                                : 'italic text-fg-secondary',
                          )}
                        >
                          {draggingId === line.id ? formatTime(line.time) : line.text || '(empty)'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {actionError && (
              <p role="alert" className="border-t border-rule/60 px-4 py-2 text-sm text-danger sm:px-6">
                {actionError}
              </p>
            )}

            {/* Transport + insert, thumb-reachable at the bottom */}
            <div className="flex items-center gap-3 border-t border-rule/60 px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-bg-primary transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Icon name={isPlaying ? 'mdi-pause' : 'mdi-play'} size={22} />
              </button>
              <Button onClick={addLineAtCenter} className="flex-1 justify-center gap-2 py-3">
                <Icon name="mdi-plus" size={18} />
                Add line at current position
              </Button>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-rule/60 px-4 py-4 sm:px-6">
              <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save</Button>
            </div>
          </div>
        </PageState>
      </div>

      <Modal
        open={editId !== null}
        onClose={closeEdit}
        title={editLine ? `Edit line at ${formatTime(editLine.time)}` : 'Edit line'}
        footer={
          <div className="flex items-center gap-2">
            <Button variant="danger" onClick={deleteEdit} className="mr-auto">Delete</Button>
            <Button variant="ghost" onClick={closeEdit}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </div>
        }
      >
        <Input
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEdit();
          }}
          aria-label="Line text"
          placeholder="Lyric line"
          className="w-full"
        />
      </Modal>

      <ConfirmModal
        open={pendingMatch !== null}
        onClose={() => setPendingMatch(null)}
        title="Replace current lyrics?"
        message={
          pendingMatch
            ? `Apply "${pendingMatch.title}"${pendingMatch.artistName ? ` by ${pendingMatch.artistName}` : ''} from LRCLIB? This overwrites the current ${pendingMatch.syncedLyrics?.length ? 'synced lines' : 'lyrics'} in the editor (not yet saved).`
            : ''
        }
        confirmLabel="Apply"
        onConfirm={() => pendingMatch && applyMatch(pendingMatch)}
      />
    </div>,
    document.body,
  );
}
