import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Song as SharedSong, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { useSongContextMenu } from '../../../hooks/useSongContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { Button } from '../../../components/ui/Button.js';
import { SyncedLyricsEditor } from '../components/SyncedLyricsEditor.js';
import { SongTable, type SongListItem } from '../components/SongTable.js';

type Song = SharedSong & {
  artistName?: string;
  albumName?: string;
  albumArtistName?: string;
};

function SongContextMenu({
  song,
  onEdit,
  isAdmin,
  children,
}: {
  song: Song;
  onEdit: () => void;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const sections = useSongContextMenu(song, onEdit, isAdmin);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function Songs({ user }: { user: User }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Song | null>(null);
  const [syncEditing, setSyncEditing] = useState<Song | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverArtBusy, setCoverArtBusy] = useState(false);
  const [orphanedEntities, setOrphanedEntities] = useState<{ type: 'artist' | 'album'; id: string; name: string }[] | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const { notify } = useNotification();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const { playSongs, shufflePlay } = usePlayActions();
  const playingId = usePlayer((state) => state.currentSong?.id);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const load = () => {
    setLoading(true);
    api<{ songs: Song[] }>(`/songs${buildLibraryQuery(selectedLibraryId)}`)
      .then((songsRes) => {
        setSongs(songsRes.songs);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load songs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [selectedLibraryId]);

  const blurExplicitTitles = user.blurExplicitTitles === true;

  const handlePlay = (song: SongListItem) => {
    playSongs([song as SharedSong], 0);
  };

  const handlePlaySelection = (songs: SongListItem[], startIndex: number) => {
    playSongs(songs as SharedSong[], startIndex);
  };

  const handleShufflePlay = (_song: SongListItem) => {
    shufflePlay(songs as SharedSong[]);
  };

  const handleSave = async (patched: Record<string, unknown>) => {
    if (!editing) return;
    setSaving(true);
    try {
      const result = await api<{ ok: boolean; orphanedEntities?: { type: 'artist' | 'album'; id: string; name: string }[] }>(`/songs/${editing.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      setEditing(null);
      if (result.orphanedEntities && result.orphanedEntities.length > 0) {
        setOrphanedEntities(result.orphanedEntities);
      } else {
        load();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save song', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCleanup = async (deleteOrphans: boolean) => {
    if (!orphanedEntities) return;
    if (deleteOrphans) {
      setCleaningUp(true);
      try {
        await Promise.all(
          orphanedEntities.map((entity) =>
            api(`/${entity.type === 'artist' ? 'artists' : 'albums'}/${entity.id}`, { method: 'DELETE' }),
          ),
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Failed to clean up empty items', 'error');
      } finally {
        setCleaningUp(false);
      }
    }
    setOrphanedEntities(null);
    load();
  };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await api(`/songs/${editing.id}`, { method: 'DELETE' });
      setEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete song', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleEditCoverArt = () => {
    coverInputRef.current?.click();
  };

  const handleCoverArtFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setCoverArtBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api(`/songs/${editing.id}/cover-art`, {
        method: 'POST',
        body: formData,
      });
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update cover art', 'error');
    } finally {
      setCoverArtBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleDeleteCoverArt = async () => {
    if (!editing) return;
    if (!window.confirm('Are you sure you want to remove the cover art?')) return;
    setCoverArtBusy(true);
    try {
      await api(`/songs/${editing.id}/cover-art`, { method: 'DELETE' });
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to remove cover art', 'error');
    } finally {
      setCoverArtBusy(false);
    }
  };

  const editEntity = editing
    ? {
        ...editing,
        artist: editing.artistName,
        album: editing.albumName,
        albumArtist: editing.albumArtistName,
      }
    : null;

  if (loading) return <p className="text-sm text-muted">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Songs</h2>
      <SongTable
        songs={songs}
        playingId={playingId}
        blurExplicit={blurExplicitTitles}
        onPlay={handlePlay}
        onShufflePlay={handleShufflePlay}
        onPlaySelection={handlePlaySelection}
        renderRow={(song, row) => (
          <SongContextMenu song={song as Song} onEdit={() => setEditing(song as Song)} isAdmin={user.isAdmin}>
            {row}
          </SongContextMenu>
        )}
        empty="No songs."
      />
      {editEntity && (
        <EditEntityModal
          open
          entityType="song"
          entity={editEntity}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          onEditCoverArt={user.isAdmin ? handleEditCoverArt : undefined}
          onDeleteCoverArt={user.isAdmin ? handleDeleteCoverArt : undefined}
          onEditSyncedLyrics={() => editing && setSyncEditing(editing)}
          saving={saving}
          deleting={deleting}
          coverArtBusy={coverArtBusy}
        />
      )}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleCoverArtFileChange}
      />
      {syncEditing && (
        <SyncedLyricsEditor
          songId={syncEditing.id}
          title={syncEditing.title}
          artistName={syncEditing.artistName}
          duration={syncEditing.duration}
          onClose={() => setSyncEditing(null)}
          onSaved={() => {
            setSyncEditing(null);
            load();
          }}
        />
      )}
      {orphanedEntities && orphanedEntities.length > 0 && (
        <CleanupModal
          entities={orphanedEntities}
          loading={cleaningUp}
          onClose={() => handleCleanup(false)}
          onConfirm={() => handleCleanup(true)}
        />
      )}
    </div>
  );
}

function CleanupModal({
  entities,
  loading,
  onClose,
  onConfirm,
}: {
  entities: { type: 'artist' | 'album'; id: string; name: string }[];
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cleanup-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-rule bg-surface shadow-2xl">
        <div className="border-b border-rule/60 px-6 py-4">
          <h3 id="cleanup-title" className="text-lg font-semibold">Empty items</h3>
        </div>
        <div className="px-6 py-5">
          <p className="mb-3 text-sm text-fg-secondary">
            The following items no longer have any songs. Delete them?
          </p>
          <ul className="space-y-2">
            {entities.map((entity) => (
              <li
                key={`${entity.type}-${entity.id}`}
                className="flex items-center gap-3 rounded-lg border border-rule bg-surface-hover px-3 py-2"
              >
                <span className="text-xs font-medium uppercase text-fg-secondary">{entity.type}</span>
                <span className="text-sm font-medium text-fg-primary">{entity.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end gap-2 border-t border-rule/60 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="btn-ghost"
          >
            Keep
          </button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            variant="danger"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
