import { useEffect, useRef, useState } from 'react';
import type { LrcLibMatch, LrcLibSearchResult, SyncedLyricLine } from '../../../../types';
import { api } from '../../../../lib/api.js';
import { normalizeSyncedLyrics, serializeLrcLines } from '../../../../lib/syncedLyrics.js';
import {
  FOCUSABLE_SELECTOR,
  PX_PER_SECOND,
  WHEEL_STEP_SECONDS,
  prefersReducedMotion,
  sortByTime,
  type EditLine,
} from './model.js';
import { computePeaks } from './peaks.js';

export interface SyncedLyricsEditorProps {
  songId: string;
  title: string;
  artistName?: string;
  duration?: number;
  onClose: () => void;
  onSaved?: () => void;
}

export function useSyncedLyricsEditor({ songId, title, artistName, duration, onClose, onSaved }: SyncedLyricsEditorProps) {
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

  // Load existing lyrics. The server answers {lyrics, syncedLyrics} with
  // both as nullable strings — syncedLyrics in LRC text.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    api<{ lyrics?: string | null; syncedLyrics?: string | null }>(`/songs/${songId}/lyrics`)
      .then((res) => {
        setLyrics(res.lyrics ?? '');
        // The wire shape is LRC text; normalize before edit.
        const loaded = toEditLines(normalizeSyncedLyrics(res.syncedLyrics));
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
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-on-surface').trim() || '0 0% 100%';

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
      // The PUT contract carries syncedLyrics as LRC text; null clears.
      await api(`/songs/${songId}/lyrics`, {
        method: 'PUT',
        body: JSON.stringify({
          lyrics,
          syncedLyrics: lines.length > 0 ? serializeLrcLines(lines.map(({ time, text }) => ({ time, text }))) : null,
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

  return {
    // state
    lyrics, lines, loading, loadError, saving, actionError, isPlaying, currentTime,
    audioDuration, peaks, peaksLoading, viewport, draggingId, editId, editText,
    fetching, pendingMatch, effectiveDuration, ready,
    // derived render values
    centerY, editLine, visibleLines,
    // refs
    audioRef, dialogRef, areaRef, canvasRef,
    // actions
    setEditText, fetchFromLrcLib, togglePlay, addLineAtCenter, handleSave,
    handleAreaPointerDown, handleAreaKeyDown, handlePillPointerDown,
    handlePillClick, handlePillKeyDown, closeEdit, saveEdit, deleteEdit,
    applyMatch, setPendingMatch,
  };
}
