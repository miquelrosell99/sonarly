import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Album, Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Icon } from '../../../components/ui/Icon.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { Card } from '../../../components/Card.js';
import { CoverArt } from '../../../components/CoverArt.js';

interface HomeData {
  genres: string[];
  mostPlayed: Album[];
  random: Album[];
  recentlyAdded: Album[];
  recentlyPlayed: Album[];
}

const GENRE_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
];

function getGenreColor(genre: string): string {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = genre.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GENRE_COLORS[Math.abs(hash) % GENRE_COLORS.length];
}

function GenreCard({ genre }: { genre: string }) {
  return (
    <Link
      href={`/genres/${encodeURIComponent(genre)}`}
      className="block overflow-hidden rounded-md border border-rule border-l-4 bg-surface p-3 transition hover:border-accent hover:bg-surface-hover"
      style={{ borderLeftColor: getGenreColor(genre) }}
    >
      <span className="text-sm font-medium text-fg-primary">{genre}</span>
    </Link>
  );
}

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

function AlbumCard({ album: initialAlbum }: { album: Album }) {
  const { playSongs } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const [album, setAlbum] = useState(initialAlbum);
  const [error, setError] = useState<string | null>(null);

  const handlePlay = async () => {
    setError(null);
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}`);
      playSongs(detail.songs, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play album');
    }
  };

  const handleFavorite = async (starred: boolean) => {
    setError(null);
    try {
      await setFavorite('album', album.id, starred);
      setAlbum((prev) => ({ ...prev, starred }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (rating: number) => {
    setError(null);
    try {
      await setRating('album', album.id, rating || undefined);
      setAlbum((prev) => ({ ...prev, rating: rating || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  return (
    <div>
      <Card
        href={`/albums/${album.id}`}
        cover={<CoverArt coverArt={album.coverArt} alt={`Cover art for ${album.name}`} />}
        favorite={{
          starred: album.starred,
          onClick: () => handleFavorite(!album.starred),
          label: album.name,
        }}
        rating={{
          value: album.rating,
          onRate: handleRate,
        }}
        play={{
          onClick: handlePlay,
          label: `Play ${album.name}`,
        }}
      >
        <div className="text-sm font-medium text-fg-primary">{album.name}</div>
        <div className="text-sm text-muted">
          {album.artistName ?? '-'}
          {album.year !== undefined && ` • ${album.year}`}
        </div>
      </Card>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<HomeData>('/home')
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load home'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!data) {
    return <p className="text-sm text-muted">No data available.</p>;
  }

  return (
    <div className="space-y-8">
      <Section title="Genres">
        {data.genres.length === 0 ? (
          <p className="text-sm text-muted">No genres found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data.genres.map((genre) => (
              <GenreCard key={genre} genre={genre} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Most played">
        {data.mostPlayed.length === 0 ? (
          <p className="text-sm text-muted">No played albums yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.mostPlayed.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Random albums">
        {data.random.length === 0 ? (
          <p className="text-sm text-muted">No albums found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.random.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Recently added">
        {data.recentlyAdded.length === 0 ? (
          <p className="text-sm text-muted">No recently added albums.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.recentlyAdded.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Recently played">
        {data.recentlyPlayed.length === 0 ? (
          <p className="text-sm text-muted">No recently played albums.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.recentlyPlayed.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
