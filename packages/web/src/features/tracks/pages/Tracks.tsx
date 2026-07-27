import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { formatDuration } from '../../../lib/format.js';

interface Track extends Song {
  artistName?: string;
  albumName?: string;
}

export function Tracks() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSong, playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();
  const playingId = usePlayer((state) => state.currentSong?.id);

  const load = () => {
    setLoading(true);
    api<{ songs: Track[] }>('/songs')
      .then((res) => setTracks(res.songs))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tracks'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const artist = get('artist');
  const album = get('album');
  const genre = get('genre');
  const favorites = get('favorites');
  const rating = get('rating');
  const unrated = get('unrated') === 'true';

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
      setTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, starred } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (track: Track, rating?: number) => {
    try {
      await setRating('song', track.id, rating);
      setTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, rating } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  const columns: LibraryViewColumn<Track>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (track) => (
        <Link href={`/tracks/${track.id}`} className="hover:text-muted">
          {track.title}
        </Link>
      ),
    },
    { key: 'artist', header: 'Artist', render: (track) => track.artistName ?? '-' },
    { key: 'album', header: 'Album', render: (track) => track.albumName ?? '-' },
    {
      key: 'duration',
      header: 'Duration',
      className: 'w-24',
      render: (track) => (track.duration ? formatDuration(track.duration) : '-'),
    },
  ];

  const cardFields: LibraryViewCardField<Track>[] = [
    { key: 'title', render: (track) => track.title },
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
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(track) => track.id}
      getHref={(track) => `/tracks/${track.id}`}
      onPlay={handlePlay}
      onPlaySelection={handlePlaySelection}
      onShufflePlay={handleShufflePlay}
      playingId={playingId}
      onFavorite={handleFavorite}
      onRate={handleRate}
      getFavorite={(track) => track.starred}
      getRating={(track) => track.rating}
      emptyMessage="No tracks match the current filters."
    />
  );
}
