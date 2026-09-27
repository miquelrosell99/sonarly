import { useState, type ReactNode } from 'react';
import { useParams, useLocation } from 'wouter';
import type { Song, User } from '../../../types';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { EntityActionsMenu } from '../../../components/EntityActionsMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { formatDuration } from '../../../lib/format.js';
import { api } from '../../../lib/api.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useLibraryMutation } from '../../../hooks/useLibraryMutation.js';
import { useSongContextMenu } from '../../../hooks/useSongContextMenu.js';
import { useSongDetail } from '../../../hooks/useEntityDetails.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { SyncedLyricsEditor } from '../../songs/index.js';
import type { SongWithNames } from '../../../lib/types.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { patchToPlayerSong } from '../../../lib/songPatch.js';

type TrackDetail = SongWithNames;

function TrackHeaderContextMenu({
  track,
  isAdmin,
  onEdit,
  onDelete,
  children,
}: {
  track: Song;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const sections = useSongContextMenu(track, onEdit, isAdmin, { onDelete });
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function Track({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const blurExplicitTitles = user.blurExplicitTitles === true;
  const { data, isLoading, error, refetch, patchDetail } = useSongDetail(id);
  const track: TrackDetail | undefined = data?.song;
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [syncEditing, setSyncEditing] = useState(false);
  const { playSong } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const { notify } = useNotification();
  const songMutation = useLibraryMutation('song');
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);
  // Header "..." menu: Edit leads (it is not admin-gated — the old header
  // button wasn't either), followed by the hook's playback/navigation/download
  // sections. The hook's own trailing Edit section is dropped: it would
  // duplicate ours for admins and its Delete lands before Edit.
  const trackMenuSections = [
    { items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: () => setEditing(true) }] },
    ...useSongContextMenu(
      track ?? ({ id: '' } as Song),
      () => setEditing(true),
      user.isAdmin,
      { onDelete: () => setDeleteOpen(true) },
    ).filter((section) => !section.items.some((item) => item.id === 'edit')),
  ];

  const handleFavorite = async (starred: boolean) => {
    if (!track) return;
    if (await songMutation.run(() => setFavorite('song', track.id, starred))) {
      patchDetail({ song: { ...track, starred } });
    }
  };

  const handleRate = async (rating?: number) => {
    if (!track) return;
    if (await songMutation.run(() => setRating('song', track.id, rating))) {
      patchDetail({ song: { ...track, rating } });
    }
  };

  const handleSave = async (patched: Record<string, unknown>) => {
    if (!track) return;
    if (
      await songMutation.run(() =>
        api(`/songs/${track.id}/tags`, {
          method: 'PUT',
          body: JSON.stringify(patched),
        }),
      )
    ) {
      if (track.id === usePlayer.getState().currentSong?.id) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    if (!track) return;
    if (await songMutation.run(() => api(`/songs/${track.id}`, { method: 'DELETE' }))) {
      setDeleteOpen(false);
      notify(`Deleted track "${track.title}"`, 'success');
      navigate('/tracks');
    }
  };

  const metadata = track
    ? [
        { label: track.artistName ?? 'Unknown artist', href: track.artistId ? `/artists/${track.artistId}` : undefined },
        { label: track.albumName ?? 'Unknown album', href: track.albumId ? `/albums/${track.albumId}` : undefined },
        { label: track.year !== undefined && track.year !== null ? String(track.year) : '', href: track.year !== undefined ? `/years/${track.year}` : undefined },
        { label: track.genre ?? '', href: track.genre ? `/genres/${encodeURIComponent(track.genre)}` : undefined },
        { label: track.duration !== undefined ? formatDuration(track.duration) : '' },
      ]
    : [];

  const editEntity = track
    ? {
        ...track,
        artist: track.artistName,
        album: track.albumName,
        albumArtist: track.albumArtistName,
      }
    : null;

  return (
    <>
      <EntityDetail
        isLoading={isLoading}
        error={error?.message ?? null}
        onRetry={() => void refetch()}
        notFound={!track}
        notFoundMessage="Track not found."
        documentTitle={track?.title}
        type="Song"
        title={
          track ? (
            <ExplicitTitle title={track.title} explicit={track.explicit} blur={blurExplicitTitles} />
          ) : undefined
        }
        cover={track ? <CoverArt coverArt={track.albumCoverArt ?? track.coverArt} alt={`Cover art for ${track.title}`} className="h-48 w-48 sm:h-56 sm:w-56" iconSize={64} /> : undefined}
        metadata={metadata}
        secondaryActions={
          track && (
            <FavoriteRatingGroup
              starred={track.starred}
              onToggleFavorite={() => handleFavorite(!track.starred)}
              rating={track.rating}
              onRate={handleRate}
            />
          )
        }
        actions={
          track && (
            <>
              <Button onClick={() => playSong(track)} className="gap-2">
                <Icon name="mdi-play" size={18} />
                Play
              </Button>
              <EntityActionsMenu sections={trackMenuSections} />
            </>
          )
        }
        renderHeaderContextMenu={(target) =>
          track ? (
            <TrackHeaderContextMenu
              track={track}
              isAdmin={user.isAdmin}
              onEdit={() => setEditing(true)}
              onDelete={() => setDeleteOpen(true)}
            >
              {target}
            </TrackHeaderContextMenu>
          ) : (
            target
          )
        }
      />
      {editEntity && (
        <EditEntityModal
          open={editing}
          entityType="song"
          entity={editEntity}
          onClose={() => setEditing(false)}
          onSave={handleSave}
          onDelete={handleDelete}
          onEditSyncedLyrics={() => setSyncEditing(true)}
          saving={songMutation.isPending}
          deleting={songMutation.isPending}
        />
      )}
      {track && (
        <ConfirmModal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Delete track"
          message={`Delete "${track.title}"? This cannot be undone.`}
          confirmLabel={songMutation.isPending ? 'Deleting…' : 'Delete'}
          danger
          onConfirm={() => void handleDelete()}
        />
      )}
      {track && syncEditing && (
        <SyncedLyricsEditor
          songId={track.id}
          title={track.title}
          artistName={track.artistName}
          duration={track.duration}
          onClose={() => setSyncEditing(false)}
          onSaved={() => {
            setSyncEditing(false);
            void refetch();
          }}
        />
      )}
    </>
  );
}
