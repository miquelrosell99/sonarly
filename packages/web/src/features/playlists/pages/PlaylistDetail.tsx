import { useParams } from 'wouter';
import type { Song, User } from '@sonarly/shared';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { PlaylistCoverGrid } from '../components/PlaylistCoverGrid.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { usePlaylistContextMenu } from '../../../hooks/usePlaylistContextMenu.js';
import { useSongContextMenu } from '../../../hooks/useSongContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { usePlaylist, type PlaylistDetailEntry } from '../../../hooks/usePlaylist.js';
import { useCreatePlaylistModal } from '../../../hooks/useCreatePlaylistModal.js';
import { SongTable, type SongListItem } from '../../songs/components/SongTable.js';

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
  song,
  onEdit,
  children,
}: {
  song: SongListItem;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const sections = useSongContextMenu(song as unknown as Song, onEdit, false);
  const visibleSections = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.id !== 'edit') }))
    .filter((section) => section.items.length > 0);
  return <ItemContextMenu sections={visibleSections}>{children}</ItemContextMenu>;
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
  const playingId = usePlayer((state) => state.currentSong?.id);

  const blurExplicitTitles = user.blurExplicitTitles === true;

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
        renderRow={(song, row) => (
          <PlaylistSongContextMenu song={song} onEdit={() => {}}>
            {row}
          </PlaylistSongContextMenu>
        )}
        empty="No songs in this playlist."
      />
    </EntityDetail>
  );
}
