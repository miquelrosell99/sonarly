import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SmartPlaylistRules, Song, SyncedLyricLine } from '@sonarly/shared';
import { api } from '../api.js';
import { cn } from '../lib/cn.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Checkbox } from './ui/Checkbox.js';
import { Modal } from './ui/Modal.js';
import { ConfirmModal } from './ui/ConfirmModal.js';
import { AutocompleteInput } from './ui/AutocompleteInput.js';
import { PillInput } from './ui/PillInput.js';
import { CoverArt } from './CoverArt.js';
import { ArtistImage } from './ArtistImage.js';
import { Icon } from './ui/Icon.js';
import { SmartPlaylistEditor } from '../features/playlists/index.js';
import { FetchMetadataModal } from './FetchMetadataModal.js';
import { FetchLyricsModal } from './FetchLyricsModal.js';

type EntityType = 'song' | 'album' | 'artist' | 'playlist';

interface EditEntityModalProps {
  open: boolean;
  entityType: EntityType;
  entity?: Record<string, unknown>;
  entities?: Record<string, unknown>[];
  onClose: () => void;
  onSave?: (patchedEntity: Record<string, unknown>) => void;
  onSaveMany?: (patchedEntity: Record<string, unknown>) => void;
  onDelete?: () => void;
  onEditCoverArt?: () => void;
  onDeleteCoverArt?: () => void;
  onEditSyncedLyrics?: () => void;
  saving?: boolean;
  deleting?: boolean;
  coverArtBusy?: boolean;
  readOnly?: boolean;
}

interface TagField {
  key: string;
  label: string;
  type?: 'text' | 'number';
  autocomplete?: 'artist' | 'album' | 'albumArtist' | 'genre';
  primary?: boolean;
  multi?: boolean;
}

const SONG_FIELDS: TagField[] = [
  { key: 'title', label: 'Title', primary: true },
  { key: 'artist', label: 'Artist', autocomplete: 'artist', primary: true, multi: true },
  { key: 'album', label: 'Album', autocomplete: 'album', primary: true },
  { key: 'albumArtist', label: 'Album artist', autocomplete: 'albumArtist', multi: true },
  { key: 'trackNumber', label: 'Track number', type: 'number' },
  { key: 'discNumber', label: 'Disc number', type: 'number' },
  { key: 'genre', label: 'Genre', autocomplete: 'genre', multi: true },
  { key: 'year', label: 'Year', type: 'number' },
];

const ALBUM_FIELDS: TagField[] = [
  { key: 'title', label: 'Title', primary: true },
  { key: 'albumArtist', label: 'Album artist', autocomplete: 'albumArtist', primary: true, multi: true },
  { key: 'year', label: 'Year', type: 'number', primary: true },
];

const VISIBILITY_OPTIONS = ['private', 'shared', 'public', 'link'] as const;

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const MULTI_VALUE_DELIMITERS = /\s*[,;\/]\s*|\s+&\s+|\s+feat\.\s+|\s+featuring\s+|\s+ft\.\s+/i;

function parseMultiValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  }
  if (typeof value === 'string') {
    return value.split(MULTI_VALUE_DELIMITERS).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function getMultiValue(entity: Record<string, unknown>, key: string, fallbackKey?: string): string[] {
  const direct = entity[key];
  if (Array.isArray(direct) && direct.length > 0) return parseMultiValue(direct);
  if (fallbackKey) {
    const fallback = entity[fallbackKey];
    if (fallback !== undefined && fallback !== null) return parseMultiValue(fallback);
  }
  if (direct !== undefined && direct !== null) return parseMultiValue(direct);
  const pluralKey = `${key}s`;
  const plural = entity[pluralKey];
  if (Array.isArray(plural) && plural.length > 0) return parseMultiValue(plural);
  return [];
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function initialTagValues(entity: Record<string, unknown>, fields: TagField[]): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const { key, multi } of fields) {
    if (multi) {
      next[key] = getMultiValue(entity, key);
    } else {
      const value = entity[key];
      next[key] = value === undefined || value === null ? '' : String(value);
    }
  }
  next.lyrics = entity.lyrics === undefined || entity.lyrics === null ? '' : String(entity.lyrics);
  return next;
}

function getCommonValue(entities: Record<string, unknown>[], key: string): unknown {
  if (entities.length === 0) return undefined;
  const first = entities[0][key];
  for (let i = 1; i < entities.length; i++) {
    if (entities[i][key] !== first) return undefined;
  }
  return first;
}

function getCommonArray(entities: Record<string, unknown>[], key: string, fallbackKey?: string): string[] | undefined {
  if (entities.length === 0) return undefined;
  const first = getMultiValue(entities[0], key, fallbackKey);
  for (let i = 1; i < entities.length; i++) {
    const current = getMultiValue(entities[i], key, fallbackKey);
    if (!arraysEqual(first, current)) return undefined;
  }
  return first;
}

function getCommonBoolean(entities: Record<string, unknown>[], key: string): boolean | null {
  if (entities.length === 0) return null;
  const first = entities[0][key];
  if (typeof first !== 'boolean') return null;
  for (let i = 1; i < entities.length; i++) {
    if (entities[i][key] !== first) return null;
  }
  return first;
}

function initialTagValuesForEntities(
  entities: Record<string, unknown>[],
  fields: TagField[],
  isMulti: boolean,
): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const { key, multi } of fields) {
    if (multi) {
      next[key] = isMulti ? (getCommonArray(entities, key) ?? []) : getMultiValue(entities[0] ?? {}, key);
    } else {
      const value = isMulti ? getCommonValue(entities, key) : entities[0]?.[key];
      next[key] = value === undefined || value === null ? '' : String(value);
    }
  }
  const lyricsValue = isMulti ? getCommonValue(entities, 'lyrics') : entities[0]?.lyrics;
  next.lyrics = lyricsValue === undefined || lyricsValue === null ? '' : String(lyricsValue);
  return next;
}

export function EditEntityModal({
  open,
  entityType,
  entity,
  entities,
  onClose,
  onSave,
  onSaveMany,
  onDelete,
  onEditCoverArt,
  onDeleteCoverArt,
  onEditSyncedLyrics,
  saving,
  deleting,
  coverArtBusy,
  readOnly,
}: EditEntityModalProps) {
  const activeEntities = entities && entities.length > 0 ? entities : entity ? [entity] : [];
  const isMulti = entities !== undefined && entities.length > 1;
  const fields = entityType === 'album' ? ALBUM_FIELDS : SONG_FIELDS;
  const [values, setValues] = useState<Record<string, string | string[]>>(() => {
    if (entityType === 'playlist') {
      return {
        name: String(getCommonValue(activeEntities, 'name') ?? ''),
        visibility: String(getCommonValue(activeEntities, 'visibility') ?? 'private'),
      };
    }
    if (entityType === 'artist') {
      return { name: String(getCommonValue(activeEntities, 'name') ?? '') };
    }
    return initialTagValuesForEntities(activeEntities, fields, isMulti);
  });
  const [explicit, setExplicit] = useState(() => getCommonBoolean(activeEntities, 'explicit'));
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<SmartPlaylistRules | undefined>(() =>
    entityType === 'playlist' ? (getCommonValue(activeEntities, 'rules') as SmartPlaylistRules | undefined) ?? undefined : undefined,
  );
  const [albumStats, setAlbumStats] = useState<{ tracks: number; discs: number } | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteCoverArt, setConfirmDeleteCoverArt] = useState(false);
  const [fetchOpen, setFetchOpen] = useState(false);
  const [fetchLyricsOpen, setFetchLyricsOpen] = useState(false);
  const [syncedLyricsOverride, setSyncedLyricsOverride] = useState<unknown[] | undefined>(undefined);
  const queryClient = useQueryClient();
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setValues(() => {
        if (entityType === 'playlist') {
          return {
            name: String(getCommonValue(activeEntities, 'name') ?? ''),
            visibility: String(getCommonValue(activeEntities, 'visibility') ?? 'private'),
          };
        }
        if (entityType === 'artist') {
          return { name: String(getCommonValue(activeEntities, 'name') ?? '') };
        }
        return initialTagValuesForEntities(activeEntities, fields, isMulti);
      });
      setExplicit(getCommonBoolean(activeEntities, 'explicit'));
      setTouchedFields(new Set());
      setSyncedLyricsOverride(undefined);
      setRules(
        entityType === 'playlist'
          ? (getCommonValue(activeEntities, 'rules') as SmartPlaylistRules | undefined) ?? undefined
          : undefined,
      );
    }
    wasOpenRef.current = open;
  }, [open, activeEntities, entityType, fields, isMulti]);

  useEffect(() => {
    if (entityType !== 'song' && entityType !== 'album') return;
    const albumName = String(values.album ?? '').trim();
    if (!albumName) {
      setAlbumStats(null);
      return;
    }
    let cancelled = false;
    api<{ albums: { id: string; name: string; artistName?: string }[] }>('/albums')
      .then(({ albums }) => {
        if (cancelled) return;
        const artistName = (Array.isArray(values.artist) ? values.artist[0] : values.artist)?.trim();
        const match = albums.find(
          (a) =>
            a.name.toLowerCase() === albumName.toLowerCase() &&
            (!artistName || !a.artistName || a.artistName.toLowerCase() === artistName.toLowerCase()),
        );
        if (!match) {
          setAlbumStats(null);
          return;
        }
        return api<{ album: { songs: Song[] } }>(`/albums/${match.id}`);
      })
      .then((detail) => {
        if (cancelled || !detail) return;
        const songs = detail.album.songs;
        const tracks = Math.max(0, ...songs.map((s) => s.trackNumber ?? 0));
        const discs = Math.max(0, ...songs.map((s) => s.discNumber ?? 0));
        setAlbumStats({ tracks, discs });
      })
      .catch(() => setAlbumStats(null));
    return () => {
      cancelled = true;
    };
  }, [entityType, values.album, values.artist]);

  const handleSave = () => {
    if (readOnly) return;
    const patched: Record<string, unknown> = {};

    if (entityType === 'playlist') {
      patched.name = values.name;
      patched.visibility = values.visibility;
      const isSmart = getCommonValue(activeEntities, 'isSmart');
      if (isSmart) {
        patched.rules = rules;
      }
    } else if (entityType === 'artist') {
      patched.name = values.name;
    } else {
      for (const { key, type, multi } of fields) {
        if (isMulti && !touchedFields.has(key)) continue;
        const raw = values[key];
        if (type === 'number') {
          patched[key] = parseNumber(String(raw));
        } else if (multi) {
          const arr = Array.isArray(raw) ? raw : [];
          patched[key] = arr.length > 0 ? arr : undefined;
        } else {
          patched[key] = raw === '' ? undefined : raw;
        }
      }
      if (entityType === 'song') {
        if (!isMulti || touchedFields.has('lyrics')) {
          patched.lyrics = values.lyrics === '' ? undefined : values.lyrics;
        }
        if (!isMulti || touchedFields.has('explicit')) {
          patched.explicit = explicit === null ? undefined : explicit;
        }
      }
    }

    if (isMulti) {
      onSaveMany?.(patched);
    } else {
      onSave?.(patched);
    }
  };

  const handleDelete = () => {
    if (!onDelete) return;
    setConfirmDelete(true);
  };

  const confirmDeleteAction = () => {
    setConfirmDelete(false);
    onDelete?.();
  };

  const updateValue = (key: string, value: string | string[]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (isMulti) {
      setTouchedFields((prev) => new Set(prev).add(key));
    }
  };

  const primaryFields = useMemo(() => fields.filter((f) => f.primary), [fields]);
  const secondaryFields = useMemo(() => fields.filter((f) => !f.primary), [fields]);

  const handleMetadataFetched = (patch: Record<string, string | string[]>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'title' && entityType === 'artist') {
        updateValue('name', value);
      } else {
        updateValue(key, value);
      }
    }
    setFetchOpen(false);
  };

  const footer = (
    <div className="flex justify-between gap-4">
      <div className="flex gap-2">
        {!readOnly && !isMulti && entityType !== 'artist' && (
          <Button variant="danger" onClick={handleDelete} disabled={deleting || saving}>
            Delete
          </Button>
        )}
        {!readOnly && !isMulti && (entityType === 'song' || entityType === 'album' || entityType === 'artist') && (
          <Button variant="ghost" onClick={() => setFetchOpen(true)} disabled={saving || deleting} className="border border-rule">
            <Icon name="mdi-music-box-outline" size={18} className="mr-1.5" />
            MusicBrainz
          </Button>
        )}
        {!readOnly && !isMulti && entityType === 'song' && (
          <Button variant="ghost" onClick={() => setFetchLyricsOpen(true)} disabled={saving || deleting} className="border border-rule">
            <Icon name="mdi-cloud-download-outline" size={18} className="mr-1.5" />
            Fetch lyrics
          </Button>
        )}
      </div>
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving || deleting}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
        {!readOnly && (
          <Button onClick={handleSave} disabled={saving || deleting}>
            Save
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isMulti ? `Edit ${activeEntities.length} ${entityType}s` : `Edit ${entityType}`}
        footer={footer}
        className="max-w-4xl"
      >
        <div className="space-y-6">
        {entityType === 'artist' ? (
          <div className="flex items-start gap-5">
            <ArtistImage
              artistId={String(activeEntities[0]?.id ?? entity?.id ?? '')}
              alt={String(values.name || 'Artist')}
              className="h-40 w-40 rounded-xl"
              iconSize={40}
            />
            <div className="flex-1">
              <Field label="Name" htmlFor="edit-name">
                {readOnly ? (
                  <ReadOnlyValue>{values.name}</ReadOnlyValue>
                ) : (
                  <Input
                    id="edit-name"
                    value={String(values.name ?? '')}
                    onChange={(e) => updateValue('name', e.target.value)}
                    placeholder="Name"
                  />
                )}
              </Field>
            </div>
          </div>
        ) : entityType === 'playlist' ? (
          <div className="space-y-4">
            <Field label="Name" htmlFor="edit-name">
              <Input
                id="edit-name"
                value={String(values.name ?? '')}
                onChange={(e) => updateValue('name', e.target.value)}
                placeholder="Name"
                disabled={readOnly}
              />
            </Field>
            <Field label="Visibility" htmlFor="edit-visibility">
              <select
                id="edit-visibility"
                value={String(values.visibility ?? 'private')}
                onChange={(e) => updateValue('visibility', e.target.value)}
                disabled={readOnly}
                className="input w-full"
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            {Boolean(getCommonValue(activeEntities, 'isSmart')) && <SmartPlaylistEditor initialRules={rules} onChange={setRules} />}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-5 sm:flex-row">
              <div className="shrink-0">
                <EditableCoverArt
                  coverArt={
                    isMulti
                      ? (getCommonValue(activeEntities, entityType === 'song' ? 'albumCoverArt' : 'coverArt') as string | undefined) ??
                        (getCommonValue(activeEntities, 'coverArt') as string | undefined)
                      : (entityType === 'song'
                          ? (entity!.albumCoverArt as string | undefined)
                          : (entity!.coverArt as string | undefined)) ??
                        (entity!.coverArt as string | undefined)
                  }
                  alt={`Cover art for ${values.title ?? entityType}`}
                  readOnly={readOnly || entityType === 'song' || isMulti}
                  busy={coverArtBusy}
                  onEdit={onEditCoverArt}
                  onRequestDelete={onDeleteCoverArt && !isMulti ? () => setConfirmDeleteCoverArt(true) : undefined}
                  onView={() => setLightboxOpen(true)}
                />
                {lightboxOpen && (
                  <CoverArtLightbox
                    coverArt={
                      isMulti
                        ? (getCommonValue(activeEntities, entityType === 'song' ? 'albumCoverArt' : 'coverArt') as string | undefined) ??
                          (getCommonValue(activeEntities, 'coverArt') as string | undefined)
                        : (entityType === 'song'
                            ? (entity!.albumCoverArt as string | undefined)
                            : (entity!.coverArt as string | undefined)) ??
                          (entity!.coverArt as string | undefined)
                    }
                    alt={`Cover art for ${values.title ?? entityType}`}
                    onClose={() => setLightboxOpen(false)}
                  />
                )}
              </div>
              <div className="grid flex-1 gap-4 sm:grid-cols-2">
                {primaryFields.map(({ key, label, type, autocomplete, multi }) => (
                  <Field
                    key={key}
                    label={label}
                    htmlFor={`edit-${key}`}
                    className={key === 'title' ? 'sm:col-span-2' : undefined}
                  >
                    {multi ? (
                      <PillInput
                        id={`edit-${key}`}
                        values={Array.isArray(values[key]) ? (values[key] as string[]) : []}
                        onChange={(value) => updateValue(key, value)}
                        autocomplete={autocomplete}
                        placeholder={label}
                        disabled={readOnly}
                      />
                    ) : (
                      <TagInput
                        id={`edit-${key}`}
                        value={String(values[key] ?? '')}
                        onChange={(value) => updateValue(key, value)}
                        type={type}
                        autocomplete={autocomplete}
                        placeholder={label}
                        disabled={readOnly}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {secondaryFields.map(({ key, label, type, autocomplete, multi }) => {
                const isCompact = key === 'trackNumber' || key === 'discNumber';
                return (
                  <Field
                    key={key}
                    label={label}
                    htmlFor={`edit-${key}`}
                    className={isCompact ? 'col-span-1' : 'col-span-2'}
                  >
                    {multi ? (
                      <PillInput
                        id={`edit-${key}`}
                        values={Array.isArray(values[key]) ? (values[key] as string[]) : []}
                        onChange={(value) => updateValue(key, value)}
                        autocomplete={autocomplete}
                        placeholder={label}
                        disabled={readOnly || (entityType === 'song' && key === 'albumArtist')}
                      />
                    ) : (
                      <TagInput
                        id={`edit-${key}`}
                        value={String(values[key] ?? '')}
                        onChange={(value) => updateValue(key, value)}
                        type={type}
                        autocomplete={autocomplete}
                        placeholder={label}
                        disabled={readOnly || (entityType === 'song' && key === 'albumArtist')}
                        locked={!readOnly && entityType === 'song' && key === 'albumArtist'}
                        hint={
                          key === 'trackNumber' && albumStats && albumStats.tracks > 0
                            ? `Max track in album: ${albumStats.tracks}`
                            : key === 'discNumber' && albumStats && albumStats.discs > 0
                              ? `Max disc in album: ${albumStats.discs}`
                              : undefined
                        }
                      />
                    )}
                  </Field>
                );
              })}
            </div>

            {entityType === 'song' && (
              <>
                <Field label="Lyrics" htmlFor="edit-lyrics">
                  <textarea
                    id="edit-lyrics"
                    value={String(values.lyrics ?? '')}
                    onChange={(e) => updateValue('lyrics', e.target.value)}
                    placeholder="Add lyrics..."
                    rows={5}
                    disabled={readOnly}
                    className="input w-full resize-none py-2 align-top !h-auto min-h-[8rem]"
                  />
                </Field>

                <div className="flex items-center justify-between rounded-lg border border-rule bg-surface px-4 py-3">
                  <span className="text-sm text-fg-secondary">
                    {((syncedLyricsOverride ?? (getCommonValue(activeEntities, 'syncedLyrics') as unknown[] | undefined))?.length ?? 0)} synced lines
                  </span>
                  {!readOnly && !isMulti && (
                    <Button variant="ghost" onClick={onEditSyncedLyrics}>
                      Edit Synced Lyrics
                    </Button>
                  )}
                </div>

                <Checkbox
                  id="edit-explicit"
                  label="Explicit content"
                  checked={explicit ?? false}
                  indeterminate={explicit === null}
                  onChange={(e) => {
                    setExplicit(e.target.checked);
                    if (isMulti) {
                      setTouchedFields((prev) => new Set(prev).add('explicit'));
                    }
                  }}
                  disabled={readOnly}
                />
              </>
            )}
          </>
        )}
      </div>
      </Modal>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${entityType}`}
        message="Are you sure you want to delete this? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDeleteAction}
      />

      <ConfirmModal
        open={confirmDeleteCoverArt}
        onClose={() => setConfirmDeleteCoverArt(false)}
        title="Remove cover art"
        message="Are you sure you want to remove the cover art? This action cannot be undone."
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          setConfirmDeleteCoverArt(false);
          onDeleteCoverArt?.();
        }}
      />

      {activeEntities[0] && (
        <FetchMetadataModal
          open={fetchOpen}
          entityType={entityType === 'song' || entityType === 'album' || entityType === 'artist' ? entityType : 'song'}
          entity={activeEntities[0]}
          onClose={() => setFetchOpen(false)}
          onApply={handleMetadataFetched}
        />
      )}

      {activeEntities[0] && entityType === 'song' && (
        <FetchLyricsModal
          open={fetchLyricsOpen}
          songId={String(activeEntities[0].id)}
          title={String(activeEntities[0].title ?? '')}
          artistName={String(activeEntities[0].artistName ?? '')}
          albumName={String(activeEntities[0].albumName ?? activeEntities[0].album ?? '')}
          duration={typeof activeEntities[0].duration === 'number' ? activeEntities[0].duration : undefined}
          currentLyrics={String(values.lyrics ?? '')}
          currentSyncedLyrics={
            (syncedLyricsOverride as SyncedLyricLine[] | undefined) ??
            (activeEntities[0].syncedLyrics as SyncedLyricLine[] | undefined)
          }
          onClose={() => setFetchLyricsOpen(false)}
          onApply={async (patch) => {
            const songId = String(activeEntities[0].id);
            await api(`/songs/${songId}/lyrics`, {
              method: 'PUT',
              body: JSON.stringify({
                lyrics: patch.lyrics,
                syncedLyrics: patch.syncedLyrics,
              }),
            });
            queryClient.invalidateQueries({ queryKey: ['lyrics', songId] });
            if (patch.lyrics !== undefined) {
              updateValue('lyrics', patch.lyrics);
            }
            if (patch.syncedLyrics !== undefined) {
              setSyncedLyricsOverride(patch.syncedLyrics);
            }
            setFetchLyricsOpen(false);
          }}
        />
      )}
    </>
  );
}

function TagInput({
  id,
  value,
  onChange,
  type,
  autocomplete,
  placeholder,
  disabled,
  locked,
  hint,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  autocomplete?: 'artist' | 'album' | 'albumArtist' | 'genre';
  placeholder?: string;
  disabled?: boolean;
  locked?: boolean;
  hint?: string;
}) {
  const lockedClass = locked ? 'border-transparent bg-transparent text-fg-primary cursor-default' : '';
  const input = autocomplete ? (
    <AutocompleteInput
      id={id}
      field={autocomplete}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={lockedClass}
    />
  ) : (
    <Input
      id={id}
      type={type ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={lockedClass}
    />
  );

  if (!hint) return input;
  return (
    <div className="space-y-1">
      {input}
      <p className="text-xs text-fg-secondary">{hint}</p>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-fg-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center rounded-lg border border-rule bg-surface px-3 text-sm text-fg-primary">
      {children}
    </div>
  );
}

function EditableCoverArt({
  coverArt,
  alt,
  readOnly,
  busy,
  onEdit,
  onRequestDelete,
  onView,
}: {
  coverArt?: string;
  alt: string;
  readOnly?: boolean;
  busy?: boolean;
  onEdit?: () => void;
  onRequestDelete?: () => void;
  onView?: () => void;
}) {
  const editable = !readOnly && (onEdit || onRequestDelete);
  return (
    <div
      className={cn(
        'group relative aspect-square h-40 w-40 overflow-hidden rounded-xl bg-surface-hover',
        onView && 'cursor-pointer',
      )}
      onClick={onView}
      role={onView ? 'button' : undefined}
      tabIndex={onView ? 0 : undefined}
      onKeyDown={
        onView
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onView();
              }
            }
          : undefined
      }
      aria-label={onView ? 'View cover art' : undefined}
    >
      <CoverArt coverArt={coverArt} alt={alt} className="h-full w-full" iconSize={40} />
      {editable && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              disabled={busy}
              aria-label="Change cover art"
              title="Change cover art"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-fg-primary shadow-sm transition hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="mdi-pencil" size={18} />
            </button>
          )}
          {onRequestDelete && coverArt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete();
              }}
              disabled={busy}
              aria-label="Remove cover art"
              title="Remove cover art"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-fg-primary shadow-sm transition hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="mdi-delete" size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CoverArtLightbox({
  coverArt,
  alt,
  onClose,
}: {
  coverArt?: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Cover art preview"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 rounded-full bg-surface/80 p-2 text-fg-primary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="mdi-close" size={24} />
      </button>
      <div className="max-h-[85vh] max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
        {coverArt ? (
          <img
            src={`/api/cover-art/${coverArt}`}
            alt={alt}
            className="max-h-[85vh] max-w-[85vw] rounded-xl object-contain shadow-2xl"
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl bg-surface shadow-2xl">
            <Icon name="mdi-album" size={64} className="text-fg-secondary" />
          </div>
        )}
      </div>
    </div>
  );
}
