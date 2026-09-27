import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import type { Album, User } from '../../../types';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Modal } from '../../../components/ui/Modal.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { ItemContextMenu, type ContextMenuSection } from '../../../components/ItemContextMenu.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { usePlayShuffleMenuSections } from '../../../hooks/usePlayShuffleMenuSections.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useAlbumsList, useGenresList, useSongsList } from '../../../hooks/useLibraryLists.js';
import { TrackList } from '../../songs/index.js';
import { AlbumList } from '../../albums/index.js';
import type { SongWithNames, UnderlayParams } from '../../../lib/types.js';

interface AlbumWithArtist extends Album {
  artistName?: string;
}

function GenreHeaderContextMenu({
  tracks,
  isAdmin,
  onRename,
  onDelete,
  children,
}: {
  tracks: SongWithNames[];
  isAdmin: boolean;
  onRename: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const playSections = usePlayShuffleMenuSections(tracks);
  const sections: ContextMenuSection[] = isAdmin
    ? [
        ...playSections,
        {
          items: [
            { id: 'rename', label: 'Rename', icon: 'mdi-pencil', onClick: onRename },
            { id: 'delete', label: 'Delete', icon: 'mdi-delete', variant: 'danger', onClick: onDelete },
          ],
        },
      ]
    : playSections;
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function RenameGenreModal({
  open,
  initialName,
  onClose,
  onSave,
}: {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename genre"
      className="max-w-md"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <Input
        aria-label="Genre name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
    </Modal>
  );
}

export function Genre({ user, underlay }: { user: User | null; underlay?: UnderlayParams }) {
  const { genre: paramGenre } = useParams<{ genre: string }>();
  const encodedGenre = underlay?.id ?? paramGenre;
  const genre = encodedGenre ? decodeURIComponent(encodedGenre) : '';
  const covered = underlay !== undefined && !underlay.fetchEnabled;

  const { playSongs, shufflePlay } = usePlayActions();
  const { notify } = useNotification();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const songsQuery = useSongsList({ libraryId: selectedLibraryId, genre: genre || undefined }, Boolean(genre) && !covered);
  const albumsQuery = useAlbumsList({ libraryId: selectedLibraryId, genre: genre || undefined }, Boolean(genre) && !covered);
  // Rename/delete address the genre by id; resolve it from the list (cached
  // under the same key the Genres page uses).
  const genresQuery = useGenresList({ libraryId: selectedLibraryId });
  const genreEntry = (genresQuery.data?.genres ?? []).find((g) => g.name === genre);
  const tracks: SongWithNames[] = songsQuery.data?.songs ?? [];
  const albums: AlbumWithArtist[] = albumsQuery.data?.albums ?? [];
  const isLoading = songsQuery.isLoading || albumsQuery.isLoading || covered;
  const error = songsQuery.error ?? albumsQuery.error;
  const isAdmin = user?.isAdmin === true;

  const [renaming, setRenaming] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const invalidateGenreData = async () => {
    await Promise.all(
      (['genres', 'songs', 'albums', 'search'] as const).map((prefix) =>
        queryClient.invalidateQueries({ queryKey: [prefix] }),
      ),
    );
  };

  const handleRename = async (name: string) => {
    if (!genreEntry) return;
    try {
      await api(`/genres/${genreEntry.id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      await invalidateGenreData();
      setRenaming(false);
      notify(`Renamed genre to "${name}"`, 'success');
      navigate(`/genres/${encodeURIComponent(name)}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to rename genre', 'error');
    }
  };

  const handleDelete = async () => {
    if (!genreEntry) return;
    setDeleting(true);
    try {
      await api(`/genres/${genreEntry.id}`, { method: 'DELETE' });
      await invalidateGenreData();
      setDeleteOpen(false);
      notify(`Deleted genre "${genre}"`, 'success');
      navigate('/genres');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete genre', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const actions = tracks.length > 0 && (
    <>
      <PlayButton variant="default" onPlay={() => playSongs(tracks)}>
        Play all
      </PlayButton>
      <Button variant="ghost" onClick={() => shufflePlay(tracks)}>
        Shuffle
      </Button>
    </>
  );

  return (
    <EntityDetail
      isLoading={isLoading}
      error={error?.message ?? null}
      notFound={!genre}
      notFoundMessage="Genre not found."
      documentTitle={genre || null}
      type="Genre"
      title={genre}
      actions={actions}
      className="space-y-8"
      renderHeaderContextMenu={(target) => (
        <GenreHeaderContextMenu
          tracks={tracks}
          isAdmin={isAdmin}
          onRename={() => setRenaming(true)}
          onDelete={() => setDeleteOpen(true)}
        >
          {target}
        </GenreHeaderContextMenu>
      )}
    >
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Tracks</h3>
        <TrackList
          tracks={tracks}
          empty={<p className="text-sm text-muted">No tracks for this genre.</p>}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Albums</h3>
        <AlbumList
          albums={albums}
          empty={<p className="text-sm text-muted">No albums for this genre.</p>}
        />
      </div>

      {genreEntry && (
        <RenameGenreModal
          open={renaming}
          initialName={genre}
          onClose={() => setRenaming(false)}
          onSave={handleRename}
        />
      )}
      {genreEntry && (
        <ConfirmModal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Delete genre"
          message={`Delete genre "${genre}"? This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          danger
          onConfirm={() => void handleDelete()}
        />
      )}
    </EntityDetail>
  );
}
