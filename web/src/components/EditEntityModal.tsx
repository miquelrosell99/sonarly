import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SmartPlaylistRules } from '../types';
import { api } from '../lib/api.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { ConfirmModal } from './ui/ConfirmModal.js';
import { Icon } from './ui/Icon.js';
import { normalizeSyncedLyrics } from '../lib/syncedLyrics.js';
import { buildSongTagsPatch } from '../lib/songEditPatch.js';
import { SONG_FIELDS, ALBUM_FIELDS } from './edit-entity/fields.js';
import { parseNumber, getCommonValue } from './edit-entity/tagValues.js';
import { useTagEditState } from './edit-entity/useTagEditState.js';
import { useAlbumStats } from './edit-entity/useAlbumStats.js';
import { ArtistEditor } from './edit-entity/ArtistEditor.js';
import { PlaylistEditor } from './edit-entity/PlaylistEditor.js';
import { SongEditor } from './edit-entity/SongEditor.js';
import { AlbumEditor } from './edit-entity/AlbumEditor.js';
import { FetchModalsHost } from './edit-entity/FetchModalsHost.js';

export type EntityType = 'song' | 'album' | 'artist' | 'playlist';

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
  const { values, explicit, touchedFields, updateValue, updateExplicit, seedValue, resetTagEdit } = useTagEditState(
    activeEntities,
    entityType,
    fields,
    isMulti,
  );
  const [rules, setRules] = useState<SmartPlaylistRules | undefined>(() =>
    entityType === 'playlist' ? (getCommonValue(activeEntities, 'rules') as SmartPlaylistRules | undefined) ?? undefined : undefined,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fetchOpen, setFetchOpen] = useState(false);
  const [fetchLyricsOpen, setFetchLyricsOpen] = useState(false);
  const [syncedLyricsOverride, setSyncedLyricsOverride] = useState<unknown[] | undefined>(undefined);
  const albumStats = useAlbumStats(entityType, values.album, values.artist);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      resetTagEdit();
      setSyncedLyricsOverride(undefined);
      setRules(
        entityType === 'playlist'
          ? (getCommonValue(activeEntities, 'rules') as SmartPlaylistRules | undefined) ?? undefined
          : undefined,
      );
    }
    wasOpenRef.current = open;
  }, [open, activeEntities, entityType, fields, isMulti]);

  // Song rows no longer embed lyrics (they dominate list payloads); the
  // single-song editor loads them on open from the lyrics endpoint. Multi
  // edits skip the fetch — lyrics are per-song content and an untouched
  // lyrics field is not part of a multi-save. The query shares the
  // ['lyrics', id] key family so external edits invalidate it too.
  const singleSongId =
    !isMulti && entityType === 'song' && activeEntities[0] ? String(activeEntities[0].id) : null;
  const lyricsQuery = useQuery({
    queryKey: ['lyrics', singleSongId],
    queryFn: () => api<{ lyrics?: string | null; syncedLyrics?: string | null }>(`/songs/${singleSongId}/lyrics`),
    enabled: open && singleSongId !== null,
    staleTime: 60_000,
  });
  const seededSongRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seededSongRef.current = null;
      return;
    }
    const data = lyricsQuery.data;
    if (!data || singleSongId === null || seededSongRef.current === singleSongId) return;
    seededSongRef.current = singleSongId;
    // Seed only what the endpoint actually holds: an empty answer must not
    // shadow a syncedLyrics value the entity record still carries.
    const synced = normalizeSyncedLyrics(data.syncedLyrics);
    if (synced.length > 0) {
      setSyncedLyricsOverride(synced);
    }
    // seedValue applies after the open-reset above and only fills an empty
    // field, so a fast typist is never clobbered by a slow fetch.
    if (data.lyrics) {
      seedValue('lyrics', data.lyrics);
    }
  }, [open, lyricsQuery.data, singleSongId, seedValue]);

  const handleSave = () => {
    if (readOnly) return;
    const patched: Record<string, unknown> = {};

    if (entityType === 'playlist') {
      patched.name = values.name;
      const isSmart = getCommonValue(activeEntities, 'isSmart');
      if (isSmart) {
        patched.rules = rules;
      }
    } else if (entityType === 'artist') {
      patched.name = values.name;
    } else if (entityType === 'song') {
      const songPatch = buildSongTagsPatch({ values, fields, isMulti, touchedFields, explicit });
      if (isMulti) {
        onSaveMany?.(songPatch);
      } else {
        onSave?.(songPatch);
      }
      return;
    } else {
      for (const { key, type, multi } of fields) {
        if (isMulti && !touchedFields.has(key)) continue;
        const raw = values[key];
        if (type === 'number') {
          patched[key] = parseNumber(String(raw));
        } else if (multi) {
          const arr = Array.isArray(raw) ? raw : [];
          patched[key] = arr.length > 0 ? arr : undefined;
        } else if (key === 'releaseType') {
          // Send null (not undefined) so clearing the field persists as NULL.
          patched[key] = raw === '' ? null : raw;
        } else {
          patched[key] = raw === '' ? undefined : raw;
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

  // The server can deliver syncedLyrics as a raw string; count normalized lines.
  const syncedLinesCount = normalizeSyncedLyrics(
    syncedLyricsOverride ?? getCommonValue(activeEntities, 'syncedLyrics'),
  ).length;

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
        title={
          isMulti ? `Edit ${activeEntities.length} ${entityType}s` : `Edit ${entityType}`
        }
        footer={footer}
        className="max-w-4xl"
      >
        <div className="space-y-6">
          {entityType === 'artist' ? (
            <ArtistEditor
              entity={entity}
              entities={entities}
              readOnly={readOnly}
              values={values}
              onValueChange={updateValue}
            />
          ) : entityType === 'playlist' ? (
            <PlaylistEditor
              readOnly={readOnly}
              isSmart={Boolean(getCommonValue(activeEntities, 'isSmart'))}
              values={values}
              onValueChange={updateValue}
              rules={rules}
              onRulesChange={setRules}
            />
          ) : entityType === 'song' ? (
            <SongEditor
              entity={entity}
              entities={entities}
              isMulti={isMulti}
              readOnly={readOnly}
              values={values}
              onValueChange={updateValue}
              explicit={explicit}
              onExplicitChange={updateExplicit}
              albumStats={albumStats}
              syncedLinesCount={syncedLinesCount}
              coverArtBusy={coverArtBusy}
              onEditCoverArt={onEditCoverArt}
              onDeleteCoverArt={onDeleteCoverArt}
              onEditSyncedLyrics={onEditSyncedLyrics}
            />
          ) : (
            <AlbumEditor
              entity={entity}
              entities={entities}
              isMulti={isMulti}
              readOnly={readOnly}
              values={values}
              onValueChange={updateValue}
              albumStats={albumStats}
              coverArtBusy={coverArtBusy}
              onEditCoverArt={onEditCoverArt}
              onDeleteCoverArt={onDeleteCoverArt}
            />
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

      {activeEntities[0] && (
        <FetchModalsHost
          open={fetchOpen}
          lyricsOpen={fetchLyricsOpen}
          entityType={entityType}
          activeEntity={activeEntities[0]}
          currentLyrics={String(values.lyrics ?? '')}
          syncedLyricsOverride={syncedLyricsOverride}
          onValueChange={updateValue}
          onSyncedLyricsOverride={setSyncedLyricsOverride}
          onClose={() => setFetchOpen(false)}
          onCloseLyrics={() => setFetchLyricsOpen(false)}
        />
      )}
    </>
  );
}
