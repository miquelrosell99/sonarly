import { useQueryClient } from '@tanstack/react-query';
import type { EntityType } from '../EditEntityModal.js';
import { api } from '../../lib/api.js';
import { normalizeSyncedLyrics } from '../../lib/syncedLyrics.js';
import { FetchMetadataModal } from '../FetchMetadataModal.js';
import { FetchLyricsModal } from '../FetchLyricsModal.js';

interface FetchModalsHostProps {
  open: boolean;
  lyricsOpen: boolean;
  entityType: EntityType;
  activeEntity: Record<string, unknown>;
  currentLyrics: string;
  syncedLyricsOverride: unknown[] | undefined;
  onValueChange: (key: string, value: string | string[]) => void;
  onSyncedLyricsOverride: (lines: unknown[] | undefined) => void;
  onClose: () => void;
  onCloseLyrics: () => void;
}

/**
 * Hosts the MusicBrainz metadata and lyrics fetch modals for the entity
 * editor, including the direct lyrics PUT + query invalidation on apply.
 * Extracted from EditEntityModal.tsx (audit F22, plan P10b) — composed by
 * EditEntityModal so the public component's behavior is unchanged.
 */
export function FetchModalsHost({
  open,
  lyricsOpen,
  entityType,
  activeEntity,
  currentLyrics,
  syncedLyricsOverride,
  onValueChange,
  onSyncedLyricsOverride,
  onClose,
  onCloseLyrics,
}: FetchModalsHostProps) {
  const queryClient = useQueryClient();

  const handleMetadataFetched = (patch: Record<string, string | string[]>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'title' && entityType === 'artist') {
        onValueChange('name', value);
      } else {
        onValueChange(key, value);
      }
    }
    onClose();
  };

  return (
    <>
      <FetchMetadataModal
        open={open}
        entityType={entityType === 'song' || entityType === 'album' || entityType === 'artist' ? entityType : 'song'}
        entity={activeEntity}
        onClose={onClose}
        onApply={handleMetadataFetched}
      />
      {entityType === 'song' && (
        <FetchLyricsModal
          open={lyricsOpen}
          songId={String(activeEntity.id)}
          title={String(activeEntity.title ?? '')}
          artistName={String(activeEntity.artistName ?? '')}
          albumName={String(activeEntity.albumName ?? activeEntity.album ?? '')}
          duration={typeof activeEntity.duration === 'number' ? activeEntity.duration : undefined}
          currentLyrics={currentLyrics}
          currentSyncedLyrics={normalizeSyncedLyrics(
            syncedLyricsOverride ?? activeEntity.syncedLyrics,
          )}
          onClose={onCloseLyrics}
          onApply={async (patch) => {
            const songId = String(activeEntity.id);
            await api(`/songs/${songId}/lyrics`, {
              method: 'PUT',
              body: JSON.stringify({
                lyrics: patch.lyrics,
                syncedLyrics: patch.syncedLyrics,
              }),
            });
            queryClient.invalidateQueries({ queryKey: ['lyrics', songId] });
            if (patch.lyrics !== undefined) {
              onValueChange('lyrics', patch.lyrics);
            }
            if (patch.syncedLyrics !== undefined) {
              onSyncedLyricsOverride(patch.syncedLyrics);
            }
            onCloseLyrics();
          }}
        />
      )}
    </>
  );
}
