import { useRef, useState, type ReactNode } from 'react';
import { useParams, useLocation } from 'wouter';
import type { Album as AlbumSummary, Song as SharedSong, User } from '../../../types';
import { api } from '../../../lib/api.js';
import { cn } from '../../../lib/cn.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { useSongsContextMenu } from '../../../hooks/useSongsContextMenu.js';
import { useAlbumContextMenu } from '../../../hooks/useAlbumContextMenu.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryMutation } from '../../../hooks/useLibraryMutation.js';
import { useAlbumDetail } from '../../../hooks/useEntityDetails.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { patchToPlayerSong } from '../../../lib/songPatch.js';
import { SyncedLyricsEditor } from '../../songs/index.js';
import { SongTable } from '../../songs/index.js';
import type { SongListItem } from '../../songs/components/SongTable.js';
import type { SongWithNames, UnderlayParams } from '../../../lib/types.js';

function SongContextMenu({
  songs,
  onEdit,
  isAdmin,
  children,
}: {
  songs: SongListItem[];
  onEdit: () => void;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const sections = useSongsContextMenu(songs as SharedSong[], onEdit, isAdmin);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function AlbumHeaderContextMenu({
  album,
  isAdmin,
  onDelete,
  children,
}: {
  album: AlbumSummary;
  isAdmin: boolean;
  onDelete: () => void;
  children: ReactNode;
}) {
  const sections = useAlbumContextMenu(album, { isAdmin, onDelete });
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function formatReleaseType(value: string): string {
  return value.length <= 3 ? value.toUpperCase() : value.charAt(0).toUpperCase() + value.slice(1);
}

export function Album({ user, underlay }: { user: User; underlay?: UnderlayParams }) {
  const { id: paramId } = useParams<{ id: string }>();
  const id = underlay?.id ?? paramId;
  const covered = underlay !== undefined && !underlay.fetchEnabled;
  const [, navigate] = useLocation();
  const { notify } = useNotification();
  const { data: detail, isLoading, error, refetch, patchDetail } = useAlbumDetail(id, !covered);
  const [songEditing, setSongEditing] = useState<SongWithNames[] | null>(null);
  const [albumEditing, setAlbumEditing] = useState<AlbumSummary | null>(null);
  const [syncEditing, setSyncEditing] = useState<SongWithNames | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [coverArtBusy, setCoverArtBusy] = useState(false);
  const albumCoverInputRef = useRef<HTMLInputElement>(null);
  const { setFavorite, setRating } = useFavoriteActions();
  const { playSongs, shufflePlay } = usePlayActions();
  const songMutation = useLibraryMutation('song');
  const albumMutation = useLibraryMutation('album');
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);
  const playingId = usePlayer((state) => state.currentSong?.id);

  const blurExplicitTitles = user.blurExplicitTitles === true;
  const blurExplicitCovers = user.blurExplicitCovers === true;

  const queueContext = id ? { type: 'album' as const, id } : undefined;

  const handlePlay = (song: SongListItem) => {
    const songs = (detail?.songs ?? []) as SharedSong[];
    const startIndex = songs.findIndex((entry) => entry.id === song.id);
    playSongs(songs.length > 0 ? songs : [song as SharedSong], Math.max(0, startIndex), undefined, queueContext);
  };

  const handlePlaySelection = (songs: SongListItem[], startIndex: number) => {
    playSongs(songs as SharedSong[], startIndex, undefined, queueContext);
  };

  const handlePlayAlbum = () => {
    if (!detail) return;
    playSongs(detail.songs as SharedSong[], undefined, undefined, queueContext);
  };

  const handleShuffleAlbumSongs = () => {
    if (!detail) return;
    shufflePlay(detail.songs as SharedSong[], queueContext);
  };

  const handleFavorite = async (starred: boolean) => {
    if (!detail) return;
    if (await albumMutation.run(() => setFavorite('album', detail.album.id, starred))) {
      patchDetail({ album: { ...detail.album, starred } });
    }
  };

  const handleRate = async (rating?: number) => {
    if (!detail) return;
    if (await albumMutation.run(() => setRating('album', detail.album.id, rating))) {
      patchDetail({ album: { ...detail.album, rating } });
    }
  };

  const handleSongSave = async (patched: Record<string, unknown>) => {
    if (!songEditing || songEditing.length !== 1) return;
    if (
      await songMutation.run(() =>
        api(`/songs/${songEditing[0].id}/tags`, {
          method: 'PUT',
          body: JSON.stringify(patched),
        }),
      )
    ) {
      if (songEditing[0].id === usePlayer.getState().currentSong?.id) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setSongEditing(null);
    }
  };

  const handleSongSaveMany = async (patched: Record<string, unknown>) => {
    if (!songEditing || songEditing.length < 2) return;
    if (
      await songMutation.run(() =>
        api('/songs/tags', {
          method: 'PUT',
          body: JSON.stringify({
            ids: songEditing.map((s) => s.id),
            tags: patched,
          }),
        }),
      )
    ) {
      const currentId = usePlayer.getState().currentSong?.id;
      if (currentId && songEditing.some((s) => s.id === currentId)) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setSongEditing(null);
    }
  };

  const handleSongDelete = async () => {
    if (!songEditing || songEditing.length !== 1) return;
    if (await songMutation.run(() => api(`/songs/${songEditing[0].id}`, { method: 'DELETE' }))) {
      setSongEditing(null);
    }
  };

  const handleAlbumSave = async (patched: Record<string, unknown>) => {
    if (!albumEditing) return;
    if (
      await albumMutation.run(() =>
        api(`/albums/${albumEditing.id}/tags`, {
          method: 'PUT',
          body: JSON.stringify(patched),
        }),
      )
    ) {
      setAlbumEditing(null);
    }
  };

  const handleAlbumDelete = async () => {
    if (!albumEditing) return;
    if (await albumMutation.run(() => api(`/albums/${albumEditing.id}`, { method: 'DELETE' }))) {
      setAlbumEditing(null);
    }
  };

  const handleHeaderDelete = async () => {
    if (!detail) return;
    if (await albumMutation.run(() => api(`/albums/${detail.album.id}`, { method: 'DELETE' }))) {
      setDeleteOpen(false);
      notify(`Deleted album "${detail.album.name}"`, 'success');
      navigate('/albums');
    }
  };

  const handleAlbumEditCoverArt = () => {
    albumCoverInputRef.current?.click();
  };

  const handleAlbumCoverArtFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !albumEditing) return;
    setCoverArtBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await albumMutation.run(() =>
        api(`/albums/${albumEditing.id}/cover-art`, {
          method: 'POST',
          body: formData,
        }),
      );
    } finally {
      setCoverArtBusy(false);
      if (albumCoverInputRef.current) albumCoverInputRef.current.value = '';
    }
  };

  const handleAlbumDeleteCoverArt = async () => {
    if (!albumEditing) return;
    setCoverArtBusy(true);
    try {
      await albumMutation.run(() => api(`/albums/${albumEditing.id}/cover-art`, { method: 'DELETE' }));
    } finally {
      setCoverArtBusy(false);
    }
  };

  const hasFilteredSongs =
    detail !== undefined &&
    detail.album.totalSongCount !== undefined &&
    detail.album.shownSongCount !== undefined &&
    detail.album.totalSongCount > detail.album.shownSongCount;

  const hiddenSongCount =
    detail?.album.totalSongCount !== undefined && detail?.album.shownSongCount !== undefined
      ? detail.album.totalSongCount - detail.album.shownSongCount
      : 0;

  const metadata = detail
    ? [
        { label: detail.album.artistName ?? 'Unknown artist', href: detail.album.artistId ? `/artists/${detail.album.artistId}` : undefined },
        { label: detail.album.releaseType ? formatReleaseType(detail.album.releaseType) : '' },
        { label: detail.album.year !== undefined && detail.album.year !== null ? String(detail.album.year) : '', href: detail.album.year !== undefined ? `/years/${detail.album.year}` : undefined },
        { label: detail.album.genre ?? '', href: detail.album.genre ? `/genres/${encodeURIComponent(detail.album.genre)}` : undefined },
      ]
    : [];

  const songEditEntities = songEditing?.map((song) => ({
    ...song,
    artist: song.artistName,
    album: song.albumName,
    albumArtist: song.albumArtistName,
  }));

  const albumEditEntity = albumEditing
    ? {
        ...albumEditing,
        title: albumEditing.name,
        albumArtist: albumEditing.artistName,
      }
    : null;

  const discNumbers = new Set(
    (detail?.songs ?? [])
      .map((song) => song.discNumber)
      .filter((disc): disc is number => disc !== undefined && disc !== null),
  );
  const hasMultipleDiscs = discNumbers.size > 1;

  return (
    <EntityDetail
      isLoading={isLoading || covered}
      error={error?.message ?? null}
      onRetry={() => void refetch()}
      notFound={!detail}
      notFoundMessage="Album not found."
      documentTitle={detail?.album.name}
      type="Album"
      title={
        detail ? (
          <ExplicitTitle
            title={detail.album.name}
            explicit={detail.album.explicit}
            blur={blurExplicitTitles}
          />
        ) : undefined
      }
      cover={
        detail && (
          <CoverArt
            coverArt={detail.album.coverArt}
            alt={`Cover art for ${detail.album.name}`}
            className={cn('h-48 w-48 rounded-xl sm:h-56 sm:w-56', blurExplicitCovers && hasFilteredSongs && 'blur-sm')}
            iconSize={64}
          />
        )
      }
      metadata={metadata}
      actions={
        detail && (
          <>
            <PlayButton variant="default" onPlay={handlePlayAlbum} onShufflePlay={handleShuffleAlbumSongs}>
              Play
            </PlayButton>
            <FavoriteRatingGroup
              starred={detail.album.starred}
              onToggleFavorite={() => handleFavorite(!detail.album.starred)}
              rating={detail.album.rating}
              onRate={handleRate}
            />
            <Button variant="ghost" onClick={() => setAlbumEditing(detail.album)} className="gap-2">
              <Icon name="mdi-pencil" size={18} />
              Edit
            </Button>
            {user.isAdmin && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)} className="gap-2">
                <Icon name="mdi-delete" size={18} />
                Delete
              </Button>
            )}
          </>
        )
      }
      headerChildren={
        hiddenSongCount > 0 && (
          <span className="text-sm text-fg-secondary">
            {hiddenSongCount} hidden
          </span>
        )
      }
      renderHeaderContextMenu={(target) =>
        detail ? (
          <AlbumHeaderContextMenu
            album={detail.album}
            isAdmin={user.isAdmin}
            onDelete={() => setDeleteOpen(true)}
          >
            {target}
          </AlbumHeaderContextMenu>
        ) : (
          target
        )
      }
    >
      <SongTable
        songs={detail?.songs ?? []}
        playingId={playingId}
        blurExplicit={blurExplicitTitles}
        onPlay={handlePlay}
        onShufflePlay={handleShuffleAlbumSongs}
        onPlaySelection={handlePlaySelection}
        getIndexLabel={(song) => song.trackNumber}
        groupBy={hasMultipleDiscs ? (song) => (song.discNumber ? String(song.discNumber) : undefined) : undefined}
        renderGroupHeader={hasMultipleDiscs ? (key) => `Disc ${Number(key).toString().padStart(2, '0')}` : undefined}
        renderRow={(_song, row, selectedRows) => (
          <SongContextMenu songs={selectedRows} onEdit={() => setSongEditing(selectedRows as SongWithNames[])} isAdmin={user.isAdmin}>
            {row}
          </SongContextMenu>
        )}
        empty="No songs."
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
          saving={songMutation.isPending}
          deleting={songMutation.isPending}
          coverArtBusy={coverArtBusy}
        />
      )}

      {albumEditEntity && (
        <EditEntityModal
          open
          entityType="album"
          entity={albumEditEntity}
          onClose={() => setAlbumEditing(null)}
          onSave={handleAlbumSave}
          onDelete={handleAlbumDelete}
          onEditCoverArt={handleAlbumEditCoverArt}
          onDeleteCoverArt={handleAlbumDeleteCoverArt}
          saving={albumMutation.isPending}
          deleting={albumMutation.isPending}
          coverArtBusy={coverArtBusy}
        />
      )}
      <input
        ref={albumCoverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleAlbumCoverArtFileChange}
      />

      {detail && (
        <ConfirmModal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Delete album"
          message={`Delete "${detail.album.name}"? This cannot be undone.`}
          confirmLabel={albumMutation.isPending ? 'Deleting…' : 'Delete'}
          danger
          onConfirm={() => void handleHeaderDelete()}
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
            void refetch();
          }}
        />
      )}
    </EntityDetail>
  );
}
