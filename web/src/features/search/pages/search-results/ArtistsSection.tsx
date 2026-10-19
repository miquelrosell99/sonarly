import { Link } from 'wouter';
import type { Artist } from '../../../../types';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../library-view/index.js';
import { ArtistContextMenu } from './contextMenus.js';
import type { SearchPageState } from './useSearchPage.js';

export function ArtistsSection({ page, artists }: { page: SearchPageState; artists: Artist[] }) {
  const { query, isLoading, error } = page;
  const columns: LibraryViewColumn<Artist>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (artist) => (
        <Link href={`/artists/${artist.id}`} className="hover:text-on-surface-variant">
          {artist.name}
        </Link>
      ),
    },
  ];
  const cardFields: LibraryViewCardField<Artist>[] = [{ key: 'name', render: (artist) => artist.name }];
  return (
    <LibraryView
      viewModeKey="search-artists"
      title={`Artists matching "${query}"`}
      data={artists}
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(artist) => artist.id}
      getHref={(artist) => `/artists/${artist.id}`}
      onPlay={(artist) => void page.playArtist(artist)}
      onFavorite={(artist, starred) => void page.handleFavorite('artist', 'artists', artist.id, starred)}
      onRate={(artist, rating) => void page.handleRate('artist', 'artists', artist.id, rating)}
      getFavorite={(artist) => artist.starred}
      getRating={(artist) => artist.rating}
      playingId={page.currentArtistId}
      renderContextMenu={(artist, children) => (
        <ArtistContextMenu artist={artist}>{children}</ArtistContextMenu>
      )}
      emptyMessage={`No artists match "${query}".`}
      emptyAction={{ label: 'Clear search', onClick: () => page.setLocation('/search') }}
      defaultView="grid"
    />
  );
}
