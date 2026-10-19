import { Link } from 'wouter';
import { ExplicitTitle } from '../../../../components/ExplicitTitle.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../library-view/index.js';
import { AlbumContextMenu } from './contextMenus.js';
import type { SearchAlbumItem } from './searchModel.js';
import type { SearchPageState } from './useSearchPage.js';

export function AlbumsSection({ page, albums }: { page: SearchPageState; albums: SearchAlbumItem[] }) {
  const { query, isLoading, error, blurExplicitTitles } = page;
  const columns: LibraryViewColumn<SearchAlbumItem>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (album) => (
        <ExplicitTitle explicit={album.explicit} blur={blurExplicitTitles}>
          <Link href={`/albums/${album.id}`} className="hover:text-on-surface-variant">
            {album.name}
          </Link>
        </ExplicitTitle>
      ),
    },
    { key: 'artist', header: 'Artist', render: (album) => album.artistName ?? '-' },
    { key: 'year', header: 'Year', className: 'w-20', render: (album) => album.year ?? '-' },
    { key: 'genre', header: 'Genre', render: (album) => album.genre ?? '-' },
  ];
  const cardFields: LibraryViewCardField<SearchAlbumItem>[] = [
    { key: 'title', render: (album) => <ExplicitTitle title={album.name} explicit={album.explicit} blur={blurExplicitTitles} /> },
    {
      key: 'artist',
      render: (album) =>
        `${album.artistName ?? '-'}${album.year !== undefined ? ` • ${album.year}` : ''}`,
    },
  ];
  return (
    <LibraryView
      viewModeKey="search-albums"
      title={`Albums matching "${query}"`}
      data={albums}
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(album) => album.id}
      getHref={(album) => `/albums/${album.id}`}
      onPlay={(album) => void page.playAlbum(album)}
      onShufflePlay={(items) => void page.shuffleAlbums(items)}
      onFavorite={(album, starred) => void page.handleFavorite('album', 'albums', album.id, starred)}
      onRate={(album, rating) => void page.handleRate('album', 'albums', album.id, rating)}
      getFavorite={(album) => album.starred}
      getRating={(album) => album.rating}
      getCover={(album) => album.coverArt}
      getCoverAlt={(album) => `Cover art for ${album.name}`}
      playingId={page.currentAlbumId}
      renderContextMenu={(album, children) => <AlbumContextMenu album={album}>{children}</AlbumContextMenu>}
      emptyMessage={`No albums match "${query}".`}
      emptyAction={{ label: 'Clear search', onClick: () => page.setLocation('/search') }}
      defaultView="grid"
    />
  );
}
