import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import type { UserPreferences } from '@sonarly/shared';
import { api } from '../../../api.js';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';

interface Album {
  id: string;
  name: string;
  year?: number;
  totalSongCount?: number;
  shownSongCount?: number;
}

interface Track {
  id: string;
  title: string;
  duration?: number;
  artistId?: string;
}

interface ArtistDetail {
  id: string;
  name: string;
  albums: Album[];
  starred?: boolean;
  rating?: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Artist() {
  const { id } = useParams<{ id: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [topTracks, setTopTracks] = useState<Track[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setFavorite, setRating } = useFavoriteActions();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api<{ artist: ArtistDetail }>(`/artists/${id}`),
      api<{ songs: Track[] }>('/songs').catch(() => ({ songs: [] })),
      api<{ preferences: UserPreferences }>('/me/preferences').catch(() => ({ preferences: {} })),
    ])
      .then(([artistRes, songsRes, prefsRes]) => {
        setArtist(artistRes.artist);
        setTopTracks(songsRes.songs.filter((s) => s.artistId === id));
        setPreferences(prefsRes.preferences);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load artist'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleFavorite = async (starred: boolean) => {
    if (!artist) return;
    try {
      await setFavorite('artist', artist.id, starred);
      setArtist((prev) => (prev ? { ...prev, starred } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!artist) return;
    try {
      await setRating('artist', artist.id, rating);
      setArtist((prev) => (prev ? { ...prev, rating } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!artist) return <p className="text-sm text-gray-500">Artist not found.</p>;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-lg font-semibold">{artist.name}</h2>
        <button
          type="button"
          onClick={() => handleFavorite(!artist.starred)}
          aria-label={artist.starred ? 'Remove favorite' : 'Add favorite'}
          title={artist.starred ? 'Remove favorite' : 'Add favorite'}
          className={cn(
            'rounded p-1 transition hover:bg-surface-hover',
            artist.starred ? 'text-accent' : 'text-muted hover:text-accent',
          )}
        >
          <Icon name={artist.starred ? 'mdi-heart' : 'mdi-heart-outline'} size={20} />
        </button>
        <span className="inline-flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => handleRate(value === artist.rating ? undefined : value)}
              aria-label={`Rate ${value} stars`}
              className={cn(
                'rounded p-0.5 transition hover:bg-surface-hover',
                value <= (artist.rating ?? 0) ? 'text-accent' : 'text-muted hover:text-accent/70',
              )}
            >
              <Icon
                name={value <= (artist.rating ?? 0) ? 'mdi-star' : 'mdi-star-outline'}
                size={18}
              />
            </button>
          ))}
        </span>
      </div>
      <h3 className="mb-2 text-sm font-medium text-gray-500">Albums</h3>
      <ul className="divide-y divide-gray-100">
        {artist.albums.map((album) => {
          const hasFilteredSongs =
            album.totalSongCount !== undefined &&
            album.shownSongCount !== undefined &&
            album.totalSongCount > album.shownSongCount;
          return (
            <li key={album.id}>
              <Link
                href={`/albums/${album.id}`}
                className="flex items-center justify-between py-2 text-sm hover:bg-gray-50"
              >
                <span className="inline-flex items-center gap-2">
                  {album.name}
                  {hasFilteredSongs && (
                    <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800">
                      {album.shownSongCount} of {album.totalSongCount} songs
                    </span>
                  )}
                </span>
                {album.year !== undefined && album.year !== null && <span className="text-gray-400">{album.year}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      {artist.albums.length === 0 && <p className="py-4 text-sm text-gray-500">No albums found.</p>}

      <h3 className="mb-2 mt-6 text-sm font-medium text-gray-500">Top tracks</h3>
      <ul className="divide-y divide-gray-100">
        {topTracks.map((track) => (
          <li key={track.id}>
            <Link
              href={`/tracks/${track.id}`}
              className="flex items-center justify-between py-2 text-sm hover:bg-gray-50"
            >
              <span>{track.title}</span>
              {track.duration !== undefined && (
                <span className="text-gray-400">{formatDuration(track.duration)}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {topTracks.length === 0 && <p className="py-4 text-sm text-gray-500">No tracks found.</p>}
    </div>
  );
}
