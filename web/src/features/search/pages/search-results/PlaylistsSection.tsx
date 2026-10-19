import { Link } from 'wouter';
import type { Playlist } from '../../../../types';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../library-view/index.js';
import { PlaylistContextMenu } from './contextMenus.js';
import type { SearchPageState } from './useSearchPage.js';

export function PlaylistsSection({ page, playlists }: { page: SearchPageState; playlists: Playlist[] }) {
  const { query, isLoading, error } = page;
  const columns: LibraryViewColumn<Playlist>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (playlist) => (
        <Link href={`/playlists/${playlist.id}`} className="hover:text-on-surface-variant">
          {playlist.name}
        </Link>
      ),
    },
    { key: 'owner', header: 'Owner', render: (playlist) => playlist.ownerUsername ?? '-' },
    { key: 'visibility', header: 'Visibility', render: (playlist) => playlist.visibility },
  ];
  const cardFields: LibraryViewCardField<Playlist>[] = [
    { key: 'name', render: (playlist) => playlist.name },
    { key: 'owner', render: (playlist) => playlist.ownerUsername ?? '-' },
  ];
  return (
    <LibraryView
      viewModeKey="search-playlists"
      title={`Playlists matching "${query}"`}
      data={playlists}
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(playlist) => playlist.id}
      getHref={(playlist) => `/playlists/${playlist.id}`}
      onPlay={(playlist) => void page.playPlaylist(playlist)}
      onShufflePlay={(items) => void page.shufflePlaylists(items)}
      onFavorite={(playlist, starred) => void page.handleFavorite('playlist', 'playlists', playlist.id, starred)}
      onRate={(playlist, rating) => void page.handleRate('playlist', 'playlists', playlist.id, rating)}
      getFavorite={(playlist) => playlist.starred}
      getRating={(playlist) => playlist.rating}
      renderContextMenu={(playlist, children) => (
        <PlaylistContextMenu playlist={playlist}>{children}</PlaylistContextMenu>
      )}
      emptyMessage={`No playlists match "${query}".`}
      emptyAction={{ label: 'Clear search', onClick: () => page.setLocation('/search') }}
      defaultView="grid"
    />
  );
}
