import { useState } from 'react';
import { useParams } from 'wouter';
import type { Song, User } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
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
import { usePlaylist, type PlaylistDetailEntry } from '../../../hooks/usePlaylist.js';
import { useCreatePlaylistModal } from '../../../hooks/useCreatePlaylistModal.js';
import { SongTable, type SongListItem } from '../../songs/components/SongTable.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { SharePlaylistModal } from '../components/SharePlaylistModal.js';
import { SyncedLyricsEditor } from '../../songs/index.js';

type DisplaySong = PlaylistDetailEntry & {
  artistName?: string;
  albumName?: string;
};

function PlaylistHeaderContextMenu({
  playlist,
  onEdit,
  onConvert,
  children,
}: {
  playlist: { id: string; name: string; visibility: string; isSmart?: boolean };
  onEdit: () => void;
  onConvert: () => void;
  children: React.ReactNode;
}) {
  const sections = usePlaylistContextMenu(
    playlist as unknown as import('@sonarly/shared').Playlist,
    onEdit,
    onConvert,
  );
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function PlaylistSongContextMenu({
  songs,
  onEdit,
  isAdmin,
  children,
}: {
  songs: SongListItem[];
  onEdit: () => void;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const sections = useSongsContextMenu(songs as unknown as Song[], onEdit, isAdmin);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

interface PlaylistDetailProps {
  user: User;
}

export function PlaylistDetail({ user }: PlaylistDetailProps) {
  const { id } = useParams<{ id: string }>();
  const { data: playlist, isLoading, error, refetch } = usePlaylist(id);
  const { openForEdit } = useCreatePlaylistModal();
  const { notify } = useNotification();
  const { setFavorite, setRating } = useFavoriteActions();
  const { playSongs, shufflePlay } = usePlayActions();
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);
  const playingId = usePlayer((state) => state.currentSong?.id);

  const [songEditing, setSongEditing] = useState<SongListItem[] | null>(null);
  const [syncEditing, setSyncEditing] = useState<SongListItem | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const blurExplicitTitles = user.blurExplicitTitles === true;
  const isOwner = playlist?.ownerId === user.id;

  const displayEntries: DisplaySong[] = playlist?.entries.map((entry) => ({
    ...entry,
    artistName: entry.artist,
    albumName: entry.album,
  })) ?? [];

  const handlePlay = (song: SongListItem) => {
    playSongs([song as unknown as Song], 0);
  };

  const handlePlaySelection = (songs: SongListItem[], startIndex: number) => {
    playSongs(songs as unknown as Song[], startIndex);
  };

  const handleShufflePlay = (_song: SongListItem) => {
    shufflePlay(displayEntries as unknown as Song[]);
  };

  const handleFavorite = async (starred: boolean) => {
    if (!playlist) return;
    try {
      await setFavorite('playlist', playlist.id, starred);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update favorite', 'error');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!playlist) return;
    try {
      await setRating('playlist', playlist.id, rating);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update rating', 'error');
    }
  };

  const handleConvert = () => {
    refetch();
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
      isLoading={isLoading}
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
      actions={
        playlist && (
          <>
            <PlayButton
              onPlay={() => playSongs(displayEntries as unknown as Song[], 0)}
              onShufflePlay={() => shufflePlay(displayEntries as unknown as Song[])}
            >
              Play
            </PlayButton>
            <Button variant="ghost" onClick={() => openForEdit(playlist.id)}>
              <Icon name="mdi-pencil" size={18} className="mr-1.5" />
              Edit
            </Button>
            {isOwner && (
              <Button variant="ghost" onClick={() => setShareOpen(true)}>
                <Icon name="mdi-share-variant" size={18} className="mr-1.5" />
                Share
              </Button>
            )}
            <FavoriteRatingGroup
              starred={playlist.starred}
              onToggleFavorite={() => handleFavorite(!playlist.starred)}
              rating={playlist.rating}
              onRate={(rating) => handleRate(rating || undefined)}
              favoriteLabel={playlist.name}
            />
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
      renderHeader={(header) =>
        playlist ? (
          <PlaylistHeaderContextMenu
            playlist={playlist}
            onEdit={() => openForEdit(playlist.id)}
            onConvert={handleConvert}
          >
            {header}
          </PlaylistHeaderContextMenu>
        ) : (
          header
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
        renderRow={(song, row, selectedRows) => (
          <PlaylistSongContextMenu songs={selectedRows} onEdit={() => setSongEditing(selectedRows)} isAdmin={user.isAdmin}>
            {row}
          </PlaylistSongContextMenu>
        )}
        empty="No songs in this playlist."
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
