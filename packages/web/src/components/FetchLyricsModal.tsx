import { useEffect, useMemo, useState } from 'react';
import type { LrcLibMatch, LrcLibSearchResult, SyncedLyricLine } from '@sonarly/shared';
import { api } from '../lib/api.js';
import { cn } from '../lib/cn.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Modal } from './ui/Modal.js';
import { Icon } from './ui/Icon.js';

interface FetchLyricsModalProps {
  open: boolean;
  songId: string;
  title: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  currentLyrics?: string;
  currentSyncedLyrics?: SyncedLyricLine[];
  onClose: () => void;
  onApply: (patch: { lyrics?: string; syncedLyrics?: SyncedLyricLine[] }) => void | Promise<void>;
}

type LyricsPatch = { lyrics?: string; syncedLyrics?: SyncedLyricLine[] };

function formatPreview(text: string | undefined, maxLines = 6): string {
  if (!text) return 'No lyrics';
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const slice = lines.slice(0, maxLines);
  return slice.join('\n') + (lines.length > maxLines ? '\n…' : '');
}

function formatSyncedPreview(lines: SyncedLyricLine[] | undefined, maxLines = 6): string {
  if (!lines || lines.length === 0) return 'No synced lyrics';
  const slice = lines.slice(0, maxLines);
  return slice.map((l) => `[${formatTime(l.time)}] ${l.text}`).join('\n') + (lines.length > maxLines ? '\n…' : '');
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function buildSearchParams(title: string, artist?: string, album?: string, duration?: number): string {
  const params = new URLSearchParams();
  params.set('title', title);
  if (artist) params.set('artist', artist);
  if (album) params.set('album', album);
  if (duration !== undefined && Number.isFinite(duration)) params.set('duration', String(duration));
  return params.toString();
}

export function FetchLyricsModal({
  open,
  songId,
  title,
  artistName,
  albumName,
  duration,
  currentLyrics,
  currentSyncedLyrics,
  onClose,
  onApply,
}: FetchLyricsModalProps) {
  const [matches, setMatches] = useState<LrcLibMatch[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [pendingPatch, setPendingPatch] = useState<LyricsPatch>({});

  const initialQuery = useMemo(
    () => buildSearchParams(title, artistName, albumName, duration),
    [title, artistName, albumName, duration],
  );

  useEffect(() => {
    if (!open) return;
    setManualQuery('');
    setPendingPatch({});
    setSelectedIndex(0);
    setError(null);
    setMatches([]);
    performSearch(initialQuery);
  }, [open, initialQuery]);

  const performSearch = async (queryString: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<LrcLibSearchResult>(`/lrclib/search?${queryString}`);
      setMatches(result.matches);
      setSelectedIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch LRCLIB lyrics');
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSearch = () => {
    const trimmed = manualQuery.trim();
    if (!trimmed) return;
    performSearch(buildSearchParams(trimmed));
  };

  const selectedMatch = matches[selectedIndex];

  const transferredValue = (key: keyof LyricsPatch): unknown => {
    return pendingPatch[key];
  };

  const isTransferred = (key: keyof LyricsPatch): boolean => {
    return key in pendingPatch;
  };

  const transferValue = (key: keyof LyricsPatch) => {
    if (!selectedMatch) return;
    if (key === 'lyrics') {
      const value = selectedMatch.lyrics;
      if (value === undefined) return;
      setPendingPatch((prev) => ({ ...prev, lyrics: value }));
    } else if (key === 'syncedLyrics') {
      const value = selectedMatch.syncedLyrics;
      if (value === undefined) return;
      setPendingPatch((prev) => ({ ...prev, syncedLyrics: value }));
    }
  };

  const revertValue = (key: keyof LyricsPatch) => {
    setPendingPatch((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      await onApply(pendingPatch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply lyrics');
    } finally {
      setApplying(false);
    }
  };

  const hasPending = Object.keys(pendingPatch).length > 0;

  const rows: Array<{ key: keyof LyricsPatch; label: string; fetched?: string; current?: string }> = [
    {
      key: 'lyrics',
      label: 'Plain lyrics',
      fetched: selectedMatch?.lyrics,
      current: currentLyrics,
    },
    {
      key: 'syncedLyrics',
      label: 'Synced lyrics',
      fetched: formatSyncedPreview(selectedMatch?.syncedLyrics),
      current: formatSyncedPreview(currentSyncedLyrics),
    },
  ];

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose} disabled={loading || applying}>
        Cancel
      </Button>
      <Button onClick={handleApply} disabled={loading || applying || !hasPending}>
        Apply
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fetch synced lyrics from LRCLIB"
      footer={footer}
      className="max-w-4xl"
    >
      <div className="space-y-4">
        {loading && matches.length === 0 && (
          <div className="flex items-center gap-2 text-fg-secondary">
            <Icon name="mdi-loading" className="animate-spin" size={20} />
            Searching LRCLIB…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={manualQuery}
            onChange={(e) => setManualQuery(e.target.value)}
            placeholder="Search LRCLIB…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleManualSearch();
            }}
            disabled={loading}
          />
          <Button onClick={handleManualSearch} disabled={loading || !manualQuery.trim()}>
            <Icon name="mdi-magnify" size={18} />
          </Button>
        </div>

        {matches.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-fg-secondary">Matches</label>
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
              className="input w-full"
              disabled={loading}
            >
              {matches.map((match, index) => (
                <option key={`${match.id}-${index}`} value={index}>
                  {match.title}
                  {match.artistName ? ` — ${match.artistName}` : ''}
                  {match.albumName ? ` (${match.albumName})` : ''}
                  {match.duration ? ` [${Math.round(match.duration)}s]` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {!loading && matches.length === 0 && !error && (
          <div className="rounded-lg border border-rule bg-surface px-4 py-6 text-center text-sm text-fg-secondary">
            No LRCLIB matches found.
          </div>
        )}

        {selectedMatch && (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm font-medium text-fg-secondary">
              <span>LRCLIB</span>
              <span />
              <span>Current</span>
            </div>

            {rows.map(({ key, label, fetched, current }) => {
              const transferred = isTransferred(key);
              const hasFetched = fetched !== undefined && fetched !== 'No lyrics' && fetched !== 'No synced lyrics';
              const displayFetched = key === 'syncedLyrics' ? formatSyncedPreview(selectedMatch.syncedLyrics) : formatPreview(fetched);
              const displayCurrent = key === 'syncedLyrics' ? formatSyncedPreview(currentSyncedLyrics) : formatPreview(current);

              return (
                <div
                  key={key}
                  className={cn(
                    'grid grid-cols-[1fr_auto_1fr] items-start gap-3 rounded-lg border border-rule p-3',
                    transferred && 'border-accent/50 bg-accent/5',
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-xs text-fg-secondary">{label}</div>
                    <pre className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-primary">{displayFetched}</pre>
                  </div>

                  <div className="flex flex-col gap-1 pt-4">
                    <button
                      type="button"
                      onClick={() => transferValue(key)}
                      disabled={!hasFetched}
                      title="Transfer value"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-fg-primary shadow-sm transition hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon name="mdi-arrow-right" size={16} />
                    </button>
                    {transferred && (
                      <button
                        type="button"
                        onClick={() => revertValue(key)}
                        title="Revert"
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-fg-primary shadow-sm transition hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <Icon name="mdi-undo" size={16} />
                      </button>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs text-fg-secondary">{label}</div>
                    <pre
                      className={cn(
                        'mt-1 whitespace-pre-wrap break-words text-sm',
                        transferred ? 'text-accent' : 'text-fg-primary',
                      )}
                    >
                      {displayCurrent}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
