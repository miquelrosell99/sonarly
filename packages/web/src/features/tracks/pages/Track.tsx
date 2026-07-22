import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';

interface TrackDetail extends Song {
  artistName?: string;
  albumName?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Track() {
  const { id } = useParams<{ id: string }>();
  const [track, setTrack] = useState<TrackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSong } = usePlayActions();

  const load = () => {
    if (!id) return;
    setLoading(true);
    api<{ song: TrackDetail }>(`/songs/${id}`)
      .then((res) => setTrack(res.song))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load track'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [id]);

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!track) return <p className="text-sm text-gray-500">Track not found.</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold">{track.title}</h2>
      <p className="text-sm text-gray-500">
        {track.artistId ? (
          <Link href={`/artists/${track.artistId}`} className="hover:text-muted">
            {track.artistName ?? 'Unknown artist'}
          </Link>
        ) : (
          track.artistName ?? 'Unknown artist'
        )}
        {' • '}
        {track.albumId ? (
          <Link href={`/albums/${track.albumId}`} className="hover:text-muted">
            {track.albumName ?? 'Unknown album'}
          </Link>
        ) : (
          track.albumName ?? 'Unknown album'
        )}
        {track.year !== undefined && track.year !== null && ` • ${track.year}`}
        {track.genre && ` • ${track.genre}`}
        {track.duration !== undefined && ` • ${formatDuration(track.duration)}`}
      </p>
      <Button onClick={() => playSong(track)} className="mt-4">
        Play
      </Button>
    </div>
  );
}
