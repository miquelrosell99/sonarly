import { Link } from 'wouter';
import type { Playlist } from '@sonarly/shared';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlaylists } from '../../../hooks/usePlaylists.js';
import { useCreatePlaylistModal } from '../../../hooks/useCreatePlaylistModal.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlaylistContextMenu } from '../../../hooks/usePlaylistContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { PlaylistCoverGrid } from '../components/PlaylistCoverGrid.js';

function PlaylistContextMenu({
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
  const sections = usePlaylistContextMenu(playlist, onEdit, onConvert);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function Playlists() {
  const { data: playlists, isLoading, error } = usePlaylists();
  const { open: openCreateModal, openForEdit } = useCreatePlaylistModal();
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();

  const owner = get('owner');
  const visibility = get('visibility');

  const filteredPlaylists = (playlists ?? []).filter((p) => {
    if (owner && p.ownerUsername !== owner) return false;
    if (visibility && p.visibility !== visibility) return false;
    return true;
  });

  const handleFavorite = async (playlist: Playlist, starred: boolean) => {
    try {
      await setFavorite('playlist', playlist.id, starred);
    } catch {
      // Error is already surfaced by the action hook via notifications.
    }
  };

  const handleRate = async (playlist: Playlist, rating?: number) => {
    try {
      await setRating('playlist', playlist.id, rating);
    } catch {
      // Error is already surfaced by the action hook via notifications.
    }
  };

  const columns: LibraryViewColumn<Playlist>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (playlist) => (
        <Link href={`/playlists/${playlist.id}`} className="hover:text-muted">
          {playlist.name}
        </Link>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (playlist) => playlist.ownerUsername,
    },
    {
      key: 'visibility',
      header: 'Visibility',
      render: (playlist) => playlist.visibility,
    },
    {
      key: 'songs',
      header: 'Songs',
      render: (playlist) => (
        <span className="font-mono tabular-nums">{playlist.songCount ?? 0}</span>
      ),
      className: 'w-20 text-right',
    },

  ];

  const cardFields: LibraryViewCardField<Playlist>[] = [
    { key: 'name', render: (playlist) => playlist.name },
    { key: 'meta', render: (playlist) => `${playlist.ownerUsername} • ${playlist.songCount ?? 0} songs` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">Playlists</h1>
        <Button onClick={openCreateModal}>
          <Icon name="mdi-plus" size={18} className="mr-1.5" />
          Create
        </Button>
      </div>
      <LibraryView
        data={filteredPlaylists}
        isLoading={isLoading}
        error={error}
        columns={columns}
        cardFields={cardFields}
        getId={(playlist) => playlist.id}
        getHref={(playlist) => `/playlists/${playlist.id}`}
        onFavorite={handleFavorite}
        onRate={handleRate}
        getFavorite={(playlist) => playlist.starred}
        getRating={(playlist) => playlist.rating}
        renderCover={(playlist) => <PlaylistCoverGrid playlistId={playlist.id} />}
        renderContextMenu={(playlist, children, _selectedItems) => (
          <PlaylistContextMenu
            playlist={playlist}
            onEdit={() => openForEdit(playlist.id)}
            onConvert={() => { /* conversion is handled by the context menu itself */ }}
          >
            {children}
          </PlaylistContextMenu>
        )}
        emptyMessage="No playlists match the current filters."
        defaultView="list"
      />
    </div>
  );
}
