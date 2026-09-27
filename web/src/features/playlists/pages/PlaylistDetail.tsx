import { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import type { Playlist, Song, User } from '../../../types';
import { api } from '../../../lib/api.js';
import type { UnderlayParams } from '../../../lib/types.js';
import { songFromPlaylistEntry } from '../../../lib/entityMappers.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { EmptyState } from '../../../components/ui/EmptyState.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { PlaylistCoverGrid } from '../components/PlaylistCoverGrid.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { patchToPlayerSong } from '../../../lib/songPatch.js';
import { usePlaylistContextMenu } from '../../../hooks/usePlaylistContextMenu.js';
import { useSongsContextMenu } from '../../../hooks/useSongsContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { usePlaylist } from '../../../hooks/usePlaylist.js';
import { useCreatePlaylistModal } from '../../../hooks/useCreatePlaylistModal.js';
import { SongTable } from '../../songs/components/SongTable.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { SharePlaylistModal } from '../components/SharePlaylistModal.js';
import { SyncedLyricsEditor } from '../../songs/index.js';

function PlaylistHeaderContextMenu({
  playlist,
  onEdit,
  onConvert,
  children,
}: {
  playlist: Playlist;
  onEdit: () => void;
  onConvert: () => void;
  children: React.ReactNode;
}) {
  const sections = usePlaylistContextMenu(playlist, onEdit, onConvert, { allowDownload: true });
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function PlaylistSongContextMenu({
  songs,
  onEdit,
  isAdmin,
  allowDownload,
  children,
}: {
  songs: Song[];
  onEdit: () => void;
  isAdmin: boolean;
  allowDownload: boolean;
  children: React.ReactNode;
}) {
  const sections = useSongsContextMenu(songs, onEdit, isAdmin, { allowDownload });
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

interface PlaylistDetailProps {
  user: User | null;
  /**
   * Now-playing underlay mount: wouter params don't include `:id` under
   * /now-playing/..., so the route threads the contextId (see
   * `UnderlayParams` in lib/types.ts). `fetchEnabled: false` means the player
   * store already covers the URL — stay silent (zero-request refresh) and
   * show the loading state instead of "not found" until the overlay closes.
   */
  underlay?: UnderlayParams;
}

export function PlaylistDetail({ user, underlay }: PlaylistDetailProps) {
  const { id: paramId } = useParams<{ id: string }>();
  const id = underlay?.id ?? paramId;
  const covered = underlay !== undefined && !underlay.fetchEnabled;
  const { data: playlist, isLoading, error, refetch } = usePlaylist(id, !covered);
  const { openForEdit } = useCreatePlaylistModal();
  const { notify } = useNotification();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { setFavorite, setRating } = useFavoriteActions();
  const { playSongs, shufflePlay } = usePlayActions();
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);
  const playingId = usePlayer((state) => state.currentSong?.id);

  const [songEditing, setSongEditing] = useState<Song[] | null>(null);
  const [syncEditing, setSyncEditing] = useState<Song | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const blurExplicitTitles = user?.blurExplicitTitles === true;
  const isOwner = user !== null && playlist?.ownerId === user.id;

  // Playlist entries ride the wire as row-level PlaylistEntry shapes; widen
  // them to full Songs through the shared mapper (audit F17 — no more casts).
  const displayEntries: Song[] = playlist?.entries.map(songFromPlaylistEntry) ?? [];

  const queueContext = id ? { type: 'playlist' as const, id } : undefined;

  const handlePlay = (song: Song) => {
    const startIndex = displayEntries.findIndex((entry) => entry.id === song.id);
    playSongs(displayEntries, Math.max(0, startIndex), undefined, queueContext);
  };

  const handlePlaySelection = (songs: Song[], startIndex: number) => {
    playSongs(songs, startIndex, undefined, queueContext);
  };

  const handleShufflePlay = (_song: Song) => {
    shufflePlay(displayEntries, queueContext);
  };

  const handleFavorite = async (starred: boolean) => {
    if (!playlist) return;
    try {
      await setFavorite('playlist', playlist.id, starred);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      await queryClient.invalidateQueries({ queryKey: ['playlist', playlist.id] });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update favorite', 'error');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!playlist) return;
    try {
      await setRating('playlist', playlist.id, rating);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      await queryClient.invalidateQueries({ queryKey: ['playlist', playlist.id] });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update rating', 'error');
    }
  };

  const handleConvert = () => {
    refetch();
  };

  const handleDelete = async () => {
    if (!playlist) return;
    setDeleting(true);
    try {
      await api(`/playlists/${playlist.id}`, { method: 'DELETE' });
      setDeleteOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      notify(`Deleted playlist "${playlist.name}"`, 'success');
      setLocation('/playlists');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete playlist', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleSongSave = async (patched: Record<string, unknown>) => {
    if (!songEditing || songEditing.length !== 1) return;
    setSaving(true);
    try {
      await api(`/songs/${songEditing[0].id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      if (songEditing[0].id === usePlayer.getState().currentSong?.id) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setSongEditing(null);
      refetch();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save song', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSongSaveMany = async (patched: Record<string, unknown>) => {
    if (!songEditing || songEditing.length < 2) return;
    setSaving(true);
    try {
      await api('/songs/tags', {
        method: 'PUT',
        body: JSON.stringify({
          ids: songEditing.map((s) => s.id),
          tags: patched,
        }),
      });
      const currentId = usePlayer.getState().currentSong?.id;
      if (currentId && songEditing.some((s) => s.id === currentId)) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setSongEditing(null);
      refetch();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save songs', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSongDelete = async () => {
    if (!songEditing || songEditing.length !== 1) return;
    setDeleting(true);
    try {
      await api(`/songs/${songEditing[0].id}`, { method: 'DELETE' });
      setSongEditing(null);
      refetch();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete song', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const songEditEntities = songEditing?.map((song) => ({
    ...song,
    artist: song.artistName,
    album: song.albumName,
  }));

  const metadata = playlist
    ? [{ label: `${playlist.songCount} song${playlist.songCount === 1 ? '' : 's'}` }]
    : [];

  return (
    <EntityDetail
      isLoading={isLoading || covered}
      error={error?.message ?? null}
      notFound={!playlist}
      notFoundMessage="Playlist not found."
      documentTitle={playlist?.name}
      type="Playlist"
      title={playlist?.name}
      cover={
        playlist && (
          <div className="h-48 w-48 sm:h-56 sm:w-56">
            <PlaylistCoverGrid playlistId={playlist.id} />
          </div>
        )
      }
      metadata={metadata}
      secondaryActions={
        playlist &&
        user && (
          <FavoriteRatingGroup
            starred={playlist.starred}
            onToggleFavorite={() => handleFavorite(!playlist.starred)}
            rating={playlist.rating}
            onRate={(rating) => handleRate(rating || undefined)}
            favoriteLabel={playlist.name}
          />
        )
      }
      actions={
        playlist && (
          <>
            <PlayButton
              onPlay={() => playSongs(displayEntries, 0, undefined, queueContext)}
              onShufflePlay={() => shufflePlay(displayEntries, queueContext)}
            >
              Play
            </PlayButton>
            {user && (
              <>
                <Button variant="ghost" onClick={() => openForEdit(playlist.id)}>
                  <Icon name="mdi-pencil" size={18} className="mr-1.5" />
                  Edit
                </Button>
                {isOwner && (
                  <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                    <Icon name="mdi-delete" size={18} className="mr-1.5" />
                    Delete
                  </Button>
                )}
                {isOwner && (
                  <Button variant="ghost" onClick={() => setShareOpen(true)}>
                    <Icon name="mdi-share-variant" size={18} className="mr-1.5" />
                    Share
                  </Button>
                )}
              </>
            )}
          </>
        )
      }
      headerChildren={
        playlist && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-secondary capitalize">
                {playlist.visibility}
              </span>
              {playlist.isSmart && (
                <span className="rounded bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-secondary">Smart</span>
              )}
            </div>
            {playlist.description && (
              <p className="max-w-prose whitespace-pre-line text-sm text-fg-secondary">{playlist.description}</p>
            )}
          </>
        )
      }
      renderHeaderContextMenu={(target) =>
        playlist && user ? (
          <PlaylistHeaderContextMenu
            playlist={playlist}
            onEdit={() => openForEdit(playlist.id)}
            onConvert={handleConvert}
          >
            {target}
          </PlaylistHeaderContextMenu>
        ) : (
          target
        )
      }
    >
      <SongTable
        songs={displayEntries}
        playingId={playingId}
        blurExplicit={blurExplicitTitles}
        onPlay={handlePlay}
        onShufflePlay={handleShufflePlay}
        onPlaySelection={handlePlaySelection}
        renderRow={(_song, row, selectedRows) => (
          // Session users always get Download (scope-based); share-link
          // guests get it only when the link opted in (shareDownload on the
          // detail DTO). Guests see no Edit/Delete (isAdmin=false).
          <PlaylistSongContextMenu
            songs={selectedRows}
            onEdit={() => setSongEditing(selectedRows)}
            isAdmin={user?.isAdmin ?? false}
            allowDownload={user !== null || playlist?.shareDownload === true}
          >
            {row}
          </PlaylistSongContextMenu>
        )}
        empty={
          <EmptyState
            className="py-2"
            icon="mdi-playlist-music"
            title="This playlist is empty"
            description="Add songs from any track, album, artist, or search page using the context menu."
          />
        }
      />

      {songEditEntities && songEditEntities.length > 0 && (
        <EditEntityModal
          open
          entityType="song"
          entities={songEditEntities}
          entity={songEditEntities.length === 1 ? songEditEntities[0] : undefined}
          onClose={() => setSongEditing(null)}
          onSave={handleSongSave}
          onSaveMany={handleSongSaveMany}
          onDelete={songEditEntities.length === 1 ? handleSongDelete : undefined}
          onEditSyncedLyrics={
            songEditEntities.length === 1 && songEditing
              ? () => songEditing && setSyncEditing(songEditing[0])
              : undefined
          }
          saving={saving}
          deleting={deleting}
        />
      )}
      {playlist && isOwner && (
        <SharePlaylistModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          playlist={playlist}
        />
      )}
      {playlist && (
        <ConfirmModal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Delete playlist"
          message={`Delete "${playlist.name}"? This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          danger
          onConfirm={handleDelete}
        />
      )}
      {syncEditing && (
        <SyncedLyricsEditor
          songId={syncEditing.id}
          title={syncEditing.title}
          artistName={syncEditing.artistName}
          duration={syncEditing.duration}
          onClose={() => setSyncEditing(null)}
          onSaved={() => {
            setSyncEditing(null);
            refetch();
          }}
        />
      )}
    </EntityDetail>
  );
}
