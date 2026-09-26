import { Link, useLocation } from 'wouter';
import type { Song, User } from '../../../types';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useSongsList } from '../../../hooks/useLibraryLists.js';
import { formatDuration } from '../../../lib/format.js';

interface TracksProps {
  user: User;
}

interface Track extends Song {
  artistName?: string;
  albumName?: string;
}

export function Tracks({ user }: TracksProps) {
  const blurExplicitTitles = user.blurExplicitTitles === true;
  const [, setLocation] = useLocation();
  const { playSong, playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();
  const playingId = usePlayer((state) => state.currentSong?.id);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data, isLoading, error, refetch, patchItem } = useSongsList({ libraryId: selectedLibraryId });
  const tracks: Track[] = data?.songs ?? [];

  const artist = get('artist');
  const album = get('album');
  const genre = get('genre');
  const favorites = get('favorites');
  const rating = get('rating');
  const unrated = get('unrated') === 'true';
  const hasActiveFilters = Boolean(
    artist || album || genre || favorites || unrated || (rating !== null && rating !== ''),
  );

  const filteredTracks = tracks.filter((track) => {
    if (artist && track.artistName !== artist) return false;
    if (album && track.albumName !== album) return false;
    if (genre && track.genre !== genre) return false;
    if (favorites === 'true' && !track.starred) return false;
    if (unrated) return track.rating === undefined || track.rating === null;
    if (rating !== null && rating !== '') {
      const r = Number(rating);
      if (!Number.isNaN(r) && track.rating !== r) return false;
    }
    return true;
  });

  const handlePlay = (track: Track) => {
    playSong(track);
  };

  const handlePlaySelection = (tracks: Track[], startIndex: number) => {
    playSongs(tracks, startIndex);
  };

  const handleShufflePlay = (tracks: Track[]) => {
    shufflePlay(tracks);
  };

  const handleFavorite = async (track: Track, starred: boolean) => {
    try {
      await setFavorite('song', track.id, starred);
      patchItem(track.id, { starred });
    } catch {
      // Favorite toggle failed server-side; keep the previous state.
    }
  };

  const handleRate = async (track: Track, rating?: number) => {
    try {
      await setRating('song', track.id, rating);
      patchItem(track.id, { rating });
    } catch {
      // Rating change failed server-side; keep the previous state.
    }
  };

  const columns: LibraryViewColumn<Track>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (track) => (
        <ExplicitTitle explicit={track.explicit} blur={blurExplicitTitles}>
          <Link href={`/tracks/${track.id}`} className="hover:text-muted">
            {track.title}
          </Link>
        </ExplicitTitle>
      ),
    },
    { key: 'artist', header: 'Artist', render: (track) => track.artistName ?? '-' },
    { key: 'album', header: 'Album', render: (track) => track.albumName ?? '-' },
    {
      key: 'duration',
      header: 'Duration',
      className: 'w-24',
      render: (track) => (
        <span className="font-mono tabular-nums">
          {track.duration ? formatDuration(track.duration) : '-'}
        </span>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<Track>[] = [
    {
      key: 'title',
      render: (track) => (
        <ExplicitTitle explicit={track.explicit} blur={blurExplicitTitles}>
          {track.title}
        </ExplicitTitle>
      ),
    },
    {
      key: 'artist',
      render: (track) => track.artistName ?? '-',
      getHref: (track) => (track.artistId ? `/artists/${track.artistId}` : undefined),
    },
    {
      key: 'album',
      render: (track) => track.albumName ?? '-',
      getHref: (track) => (track.albumId ? `/albums/${track.albumId}` : undefined),
    },
  ];

  return (
    <LibraryView
      title="Tracks"
      data={filteredTracks}
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(track) => track.id}
      getHref={(track) => `/tracks/${track.id}`}
      onPlay={handlePlay}
      onPlaySelection={handlePlaySelection}
      onShufflePlay={handleShufflePlay}
      disableRowShuffle
      playingId={playingId}
      onFavorite={handleFavorite}
      onRate={handleRate}
      getFavorite={(track) => track.starred}
      getRating={(track) => track.rating}
      emptyMessage={
        hasActiveFilters
          ? 'No tracks match the current filters.'
          : 'Your library has no tracks yet.'
      }
      emptyDescription={!hasActiveFilters && tracks.length === 0 && user.isAdmin ? 'Upload music from the top bar to get started.' : undefined}
      emptyAction={hasActiveFilters ? { label: 'Clear filters', onClick: () => setLocation('/tracks') } : undefined}
      onRetry={() => void refetch()}
    />
  );
}
