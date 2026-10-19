import { Link } from 'wouter';
import type { Song } from '../../../../types';
import { ExplicitTitle } from '../../../entities/ExplicitTitle.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../library-view/index.js';
import { SONG_COLUMN_CONFIG_KEY } from '../../../songs/components/SongTable.js';
import { SongContextMenu } from './contextMenus.js';
import { formatDuration } from './searchModel.js';
import type { SearchPageState } from './useSearchPage.js';

export function SongsSection({ page, songs }: { page: SearchPageState; songs: Song[] }) {
  const { query, isLoading, error, blurExplicitTitles } = page;
  const columns: LibraryViewColumn<Song>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (song) => (
        <ExplicitTitle explicit={song.explicit} blur={blurExplicitTitles}>
          <Link href={`/tracks/${song.id}`} className="hover:text-on-surface-variant">
            {song.title}
          </Link>
        </ExplicitTitle>
      ),
    },
    { key: 'artist', header: 'Artist', render: (song) => song.artistName ?? '-' },
    { key: 'album', header: 'Album', render: (song) => song.albumName ?? '-' },
    {
      key: 'duration',
      header: 'Duration',
      className: 'w-24',
      render: (song) => (
        <span className="font-mono tabular-nums">
          {song.duration ? formatDuration(song.duration) : '-'}
        </span>
      ),
    },
  ];
  const cardFields: LibraryViewCardField<Song>[] = [
    {
      key: 'title',
      render: (song) => (
        <ExplicitTitle explicit={song.explicit} blur={blurExplicitTitles}>
          {song.title}
        </ExplicitTitle>
      ),
    },
    { key: 'artist', render: (song) => song.artistName ?? '-' },
    { key: 'album', render: (song) => song.albumName ?? '-' },
  ];
  return (
    <LibraryView
      viewModeKey="search-songs"
      columnConfigKey={SONG_COLUMN_CONFIG_KEY}
      title={`Songs matching "${query}"`}
      data={songs}
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(song) => song.id}
      getHref={(song) => `/tracks/${song.id}`}
      onPlay={page.playSong}
      onPlaySelection={page.playSongs}
      onShufflePlay={page.shufflePlay}
      getDragSongIds={(song, selectedItems) =>
        selectedItems.some((selected) => selected.id === song.id)
          ? selectedItems.map((selected) => selected.id)
          : [song.id]
      }
      onFavorite={(song, starred) => void page.handleFavorite('song', 'songs', song.id, starred)}
      onRate={(song, rating) => void page.handleRate('song', 'songs', song.id, rating)}
      getFavorite={(song) => song.starred}
      getRating={(song) => song.rating}
      playingId={page.playingId}
      renderContextMenu={(_song, children, selectedItems) => (
        <SongContextMenu songs={selectedItems} onEdit={() => page.setSongEditing(selectedItems)} isAdmin={page.user.isAdmin}>
          {children}
        </SongContextMenu>
      )}
      emptyMessage={`No songs match "${query}".`}
      emptyAction={{ label: 'Clear search', onClick: () => page.setLocation('/search') }}
    />
  );
}
