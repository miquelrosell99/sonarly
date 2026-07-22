import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';

interface Track extends Song {
  artistName?: string;
  albumName?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Tracks() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSong, playSongs } = usePlayActions();

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

  const handlePlay = (track: Track) => {
    playSong(track);
  };

  const handleShufflePlay = (track: Track) => {
    playSongs([track], 0, true);
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
    { key: 'artist', render: (track) => track.artistName ?? '-' },
    { key: 'album', render: (track) => track.albumName ?? '-' },
  ];

  return (
    <LibraryView
      title="Tracks"
      data={tracks}
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(track) => track.id}
      getHref={(track) => `/tracks/${track.id}`}
      onPlay={handlePlay}
      onShufflePlay={handleShufflePlay}
      emptyMessage="No tracks found."
    />
  );
}
