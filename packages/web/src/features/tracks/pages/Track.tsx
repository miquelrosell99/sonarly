import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { cn } from '../../../lib/cn.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';

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
  const { setFavorite, setRating } = useFavoriteActions();

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

  const handleFavorite = async (starred: boolean) => {
    if (!track) return;
    try {
      await setFavorite('song', track.id, starred);
      setTrack((prev) => (prev ? { ...prev, starred } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!track) return;
    try {
      await setRating('song', track.id, rating);
      setTrack((prev) => (prev ? { ...prev, rating } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!track) return <p className="text-sm text-gray-500">Track not found.</p>;

  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{track.title}</h2>
        <button
          type="button"
          onClick={() => handleFavorite(!track.starred)}
          aria-label={track.starred ? 'Remove favorite' : 'Add favorite'}
          title={track.starred ? 'Remove favorite' : 'Add favorite'}
          className={cn(
            'rounded p-1 transition hover:bg-surface-hover',
            track.starred ? 'text-accent' : 'text-muted hover:text-accent',
          )}
        >
          <Icon name={track.starred ? 'mdi-heart' : 'mdi-heart-outline'} size={20} />
        </button>
        <span className="inline-flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => handleRate(value === track.rating ? undefined : value)}
              aria-label={`Rate ${value} stars`}
              className={cn(
                'rounded p-0.5 transition hover:bg-surface-hover',
                value <= (track.rating ?? 0) ? 'text-accent' : 'text-muted hover:text-accent/70',
              )}
            >
              <Icon
                name={value <= (track.rating ?? 0) ? 'mdi-star' : 'mdi-star-outline'}
                size={18}
              />
            </button>
          ))}
        </span>
      </div>
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
