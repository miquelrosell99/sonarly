import { useEffect, useMemo, useState } from 'react';
import type { MusicBrainzMatch, MusicBrainzSearchResult, SongTags } from '@sonarly/shared';
import { api } from '../lib/api.js';
import { cn } from '../lib/cn.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Modal } from './ui/Modal.js';
import { Icon } from './ui/Icon.js';
import { CoverArt } from './CoverArt.js';

type EntityType = 'song' | 'album' | 'artist';

interface FetchMetadataModalProps {
  open: boolean;
  entityType: EntityType;
  entity: Record<string, unknown>;
  onClose: () => void;
  onApply: (patch: Record<string, string | string[]>) => void;
  onCoverArtApplied?: () => void;
}

interface FieldMapping {
  key: keyof SongTags | 'coverArt';
  label: string;
  multi?: boolean;
}

const SONG_FIELDS: FieldMapping[] = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist', multi: true },
  { key: 'album', label: 'Album' },
  { key: 'albumArtist', label: 'Album artist', multi: true },
  { key: 'trackNumber', label: 'Track number' },
  { key: 'discNumber', label: 'Disc number' },
  { key: 'genre', label: 'Genre', multi: true },
  { key: 'year', label: 'Year' },
  { key: 'coverArt', label: 'Cover art' },
];

const ALBUM_FIELDS: FieldMapping[] = [
  { key: 'title', label: 'Title' },
  { key: 'albumArtist', label: 'Album artist', multi: true },
  { key: 'year', label: 'Year' },
  { key: 'coverArt', label: 'Cover art' },
];

const ARTIST_FIELDS: FieldMapping[] = [{ key: 'title', label: 'Name' }];

function getFields(entityType: EntityType): FieldMapping[] {
  if (entityType === 'album') return ALBUM_FIELDS;
  if (entityType === 'artist') return ARTIST_FIELDS;
  return SONG_FIELDS;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function toArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const arr = value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(/;\s*|\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

function getInternalValue(entity: Record<string, unknown>, key: string, entityType: EntityType): string | string[] | undefined {
  if (key === 'coverArt') {
    return formatValue(
      entityType === 'song'
        ? entity.albumCoverArt ?? entity.coverArt
        : entity.coverArt,
    );
  }
  if (key === 'title' && entityType === 'artist') {
    return formatValue(entity.name);
  }
  if (key === 'artist') {
    return toArray(entity.artists) ?? toArray(entity.artistName) ?? toArray(entity.artist);
  }
  if (key === 'albumArtist') {
    return toArray(entity.albumArtists) ?? toArray(entity.albumArtistName) ?? toArray(entity.albumArtist);
  }
  if (key === 'genre') {
    return toArray(entity.genres) ?? toArray(entity.genre);
  }
  const value = entity[key] ?? entity[key === 'title' ? 'name' : key];
  return value === undefined || value === null ? undefined : formatValue(value);
}

function getMusicBrainzValue(match: MusicBrainzMatch | undefined, key: string): string | string[] | undefined {
  if (!match) return undefined;
  if (key === 'title') return match.title;
  if (key === 'artist') return match.artists ?? toArray(match.artist);
  if (key === 'albumArtist') return match.albumArtists ?? toArray(match.albumArtist);
  if (key === 'genre') return match.genres ?? toArray(match.genre);
  return formatValue(match[key as keyof MusicBrainzMatch]);
}

function valueToString(value: string | string[] | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join('; ');
  return String(value);
}

function hasValue(value: string | string[] | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== '';
}

function buildSearchQuery(entityType: EntityType, entity: Record<string, unknown>): {
  title: string;
  artist?: string;
  album?: string;
  mbid?: string;
} {
  if (entityType === 'artist') {
    return { title: formatValue(entity.name || entity.title) };
  }
  if (entityType === 'album') {
    return {
      title: formatValue(entity.name || entity.title),
      artist: formatValue(entity.artistName || entity.albumArtist || entity.artist),
      mbid: formatValue(entity.musicBrainzAlbumId),
    };
  }
  return {
    title: formatValue(entity.title),
    artist: formatValue(entity.artistName || entity.artist),
    album: formatValue(entity.albumName || entity.album),
    mbid: formatValue(entity.musicBrainzTrackId || entity.musicBrainzId),
  };
}

function ValuePills({ values }: { values: string | string[] | undefined }) {
  if (!hasValue(values)) return <span className="text-sm text-fg-secondary">—</span>;
  const arr = Array.isArray(values) ? values : [values];
  return (
    <div className="flex flex-wrap gap-1">
      {arr.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="inline-block rounded-full bg-surface-hover px-2 py-0.5 text-sm text-fg-primary"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

export function FetchMetadataModal({
  open,
  entityType,
  entity,
  onClose,
  onApply,
  onCoverArtApplied,
}: FetchMetadataModalProps) {
  const fields = useMemo(() => getFields(entityType), [entityType]);
  const [matches, setMatches] = useState<MusicBrainzMatch[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [pendingPatch, setPendingPatch] = useState<Record<string, string | string[]>>({});
  const [applyingCoverArt, setApplyingCoverArt] = useState(false);
  const [coverArtMessage, setCoverArtMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const initialQuery = useMemo(() => buildSearchQuery(entityType, entity), [entityType, entity]);

  useEffect(() => {
    if (!open) return;
    setManualQuery('');
    setPendingPatch({});
    setSelectedIndex(0);
    setError(null);
    setMatches([]);
    performSearch(initialQuery);
  }, [open, initialQuery]);

  const performSearch = async (query: {
    title: string;
    artist?: string;
    album?: string;
    mbid?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('entityType', entityType);
      if (query.title) params.set('title', query.title);
      if (query.artist) params.set('artist', query.artist);
      if (query.album) params.set('album', query.album);
      if (query.mbid) params.set('mbid', query.mbid);
      const result = await api<MusicBrainzSearchResult>(`/musicbrainz/search?${params.toString()}`);
      setMatches(result.matches);
      setSelectedIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch MusicBrainz data');
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSearch = () => {
    const trimmed = manualQuery.trim();
    if (!trimmed) return;
    performSearch({ title: trimmed });
  };

  const selectedMatch = matches[selectedIndex];

  const internalValues: Record<string, string | string[]> = useMemo(() => {
    const next: Record<string, string | string[]> = {};
    for (const { key } of fields) {
      const value = getInternalValue(entity, key, entityType);
      next[key] = value ?? '';
    }
    return next;
  }, [fields, entity, entityType]);

  const transferredValue = (key: string): string | string[] | undefined => {
    if (key in pendingPatch) return pendingPatch[key];
    return undefined;
  };

  const displayedInternalValue = (key: string): string | string[] => {
    const transferred = transferredValue(key);
    return transferred !== undefined ? transferred : internalValues[key];
  };

  const isTransferred = (key: string): boolean => key in pendingPatch;

  const transferValue = (key: string) => {
    const mbValue = getMusicBrainzValue(selectedMatch, key);
    if (!hasValue(mbValue)) return;
    setPendingPatch((prev) => ({ ...prev, [key]: mbValue as string | string[] }));
  };

  const revertValue = (key: string) => {
    setPendingPatch((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleApply = () => {
    onApply(pendingPatch);
    onClose();
  };

  const handleApplyCoverArt = async () => {
    const url = selectedMatch?.coverArt;
    if (!url || entityType === 'artist') return;
    const entityId = String(entity.id ?? '');
    if (!entityId) return;

    setApplyingCoverArt(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Cover art source returned ${response.status}`);
      const blob = await response.blob();
      const formData = new FormData();
      formData.append('coverArt', blob, 'cover-art');
      const endpoint = entityType === 'album' ? `/albums/${entityId}/cover-art` : `/songs/${entityId}/cover-art`;
      await api(endpoint, { method: 'POST', body: formData });
      setCoverArtMessage({ type: 'success', text: 'Cover art applied' });
      onCoverArtApplied?.();
    } catch (err) {
      setCoverArtMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to apply cover art' });
    } finally {
      setApplyingCoverArt(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose} disabled={loading || applyingCoverArt}>
        Cancel
      </Button>
      <Button onClick={handleApply} disabled={loading || applyingCoverArt || Object.keys(pendingPatch).length === 0}>
        Apply
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Fetch MusicBrainz metadata for ${entityType}`}
      footer={footer}
      className="max-w-4xl"
    >
      <div className="space-y-4">
        {loading && matches.length === 0 && (
          <div className="flex items-center gap-2 text-fg-secondary">
            <Icon name="mdi-loading" className="animate-spin" size={20} />
            Searching MusicBrainz...
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
            placeholder="Search MusicBrainz..."
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
                  {match.artist ? ` — ${match.artist}` : ''}
                  {match.disambiguation ? ` (${match.disambiguation})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {!loading && matches.length === 0 && !error && (
          <div className="rounded-lg border border-rule bg-surface px-4 py-6 text-center text-sm text-fg-secondary">
            No MusicBrainz matches found.
          </div>
        )}

        {coverArtMessage && (
          <div
            className={cn(
              'rounded-lg px-4 py-3 text-sm',
              coverArtMessage.type === 'success'
                ? 'border border-success/30 bg-success/10 text-success'
                : 'border border-danger/30 bg-danger/10 text-danger',
            )}
          >
            {coverArtMessage.text}
          </div>
        )}

        {selectedMatch && (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm font-medium text-fg-secondary">
              <span>MusicBrainz</span>
              <span />
              <span>Internal</span>
            </div>

            {fields.map(({ key, label, multi }) => {
              const mbValue = getMusicBrainzValue(selectedMatch, key);
              const internalValue = displayedInternalValue(key);
              const transferred = isTransferred(key);
              const mbHasValue = hasValue(mbValue);
              const isCoverArt = key === 'coverArt';

              return (
                <div
                  key={key}
                  className={cn(
                    'grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg border border-rule p-3',
                    transferred && 'border-accent/50 bg-accent/5',
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-xs text-fg-secondary">{label}</div>
                    {isCoverArt ? (
                      mbValue ? (
                        <img
                          src={String(mbValue)}
                          alt="MusicBrainz cover art"
                          className="mt-1 h-20 w-20 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="text-sm text-fg-secondary">No cover art</span>
                      )
                    ) : multi ? (
                      <ValuePills values={mbValue} />
                    ) : (
                      <div className="truncate text-sm text-fg-primary">{mbHasValue ? valueToString(mbValue) : '—'}</div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    {isCoverArt ? (
                      <button
                        type="button"
                        onClick={handleApplyCoverArt}
                        disabled={!mbValue || applyingCoverArt || entityType === 'artist'}
                        title="Apply cover art"
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-fg-primary shadow-sm transition hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {applyingCoverArt ? (
                          <Icon name="mdi-loading" className="animate-spin" size={16} />
                        ) : (
                          <Icon name="mdi-check" size={16} />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => transferValue(key)}
                        disabled={!mbHasValue}
                        title="Transfer value"
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-fg-primary shadow-sm transition hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Icon name="mdi-arrow-right" size={16} />
                      </button>
                    )}
                    {!isCoverArt && transferred && (
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
                    {isCoverArt ? (
                      internalValue ? (
                        <CoverArt coverArt={String(internalValue)} alt="Current cover art" className="mt-1 h-20 w-20 rounded-lg" iconSize={24} />
                      ) : (
                        <span className="text-sm text-fg-secondary">No cover art</span>
                      )
                    ) : multi ? (
                      <div className={transferred ? 'text-accent' : 'text-fg-primary'}>
                        <ValuePills values={internalValue} />
                      </div>
                    ) : (
                      <div className={cn('truncate text-sm', transferred ? 'text-accent' : 'text-fg-primary')}>
                        {valueToString(internalValue) || '—'}
                      </div>
                    )}
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
