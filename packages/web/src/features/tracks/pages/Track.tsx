import { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { EntityHeader } from '../../../components/EntityHeader.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { formatDuration } from '../../../lib/format.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import type { SongWithNames } from '../../../lib/types.js';

type TrackDetail = SongWithNames;

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

  if (loading) return <p className="text-sm text-muted">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!track) return <p className="text-sm text-muted">Track not found.</p>;

  const metadata = [
    { label: track.artistName ?? 'Unknown artist', href: track.artistId ? `/artists/${track.artistId}` : undefined },
    { label: track.albumName ?? 'Unknown album', href: track.albumId ? `/albums/${track.albumId}` : undefined },
    { label: track.year !== undefined && track.year !== null ? String(track.year) : '', href: track.year !== undefined ? `/years/${track.year}` : undefined },
    { label: track.genre ?? '', href: track.genre ? `/genres/${encodeURIComponent(track.genre)}` : undefined },
    { label: track.duration !== undefined ? formatDuration(track.duration) : '' },
  ];

  return (
    <EntityHeader
      type="Song"
      title={track.title}
      cover={<CoverArt coverArt={track.coverArt} alt={`Cover art for ${track.title}`} className="h-48 w-48 sm:h-56 sm:w-56" iconSize={64} />}
      metadata={metadata}
      actions={
        <>
          <Button onClick={() => playSong(track)} className="gap-2">
            <Icon name="mdi-play" size={18} />
            Play
          </Button>
          <FavoriteRatingGroup
            starred={track.starred}
            onToggleFavorite={() => handleFavorite(!track.starred)}
            rating={track.rating}
            onRate={handleRate}
          />
        </>
      }
    />
  );
}
