import { useEffect, useState, useMemo, useRef } from 'react';
import { Link } from 'wouter';
import type { Album, Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Icon } from '../../../components/ui/Icon.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useDominantColor } from '../../../hooks/useDominantColor.js';
import { Card } from '../../../components/Card.js';
import { CoverArt } from '../../../components/CoverArt.js';

interface HomeData {
  mostPlayed: Album[];
  random: Album[];
  recentlyAdded: Album[];
  recentlyPlayed: Album[];
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
        title={album.name}
        fields={[
          {
            content: (
              <span>
                {album.artistId ? (
                  <Link href={`/artists/${album.artistId}`} className="hover:text-muted">
                    {album.artistName ?? 'Unknown artist'}
                  </Link>
                ) : (
                  album.artistName ?? '-'
                )}
                {album.year !== undefined && album.year !== null && (
                  <>
                    {' • '}
                    <Link href={`/years/${album.year}`} className="hover:text-muted">
                      {album.year}
                    </Link>
                  </>
                )}
              </span>
            ),
          },
        ]}
        cover={
          <CoverArt
            coverArt={album.coverArt}
            alt={`Cover art for ${album.name}`}
            className="rounded-xl"
          />
        }
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
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    updateScrollState();
  }, [children]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            aria-label={`Scroll ${title} left`}
            className="rounded-full p-1 text-fg-secondary transition hover:bg-surface hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Icon name="mdi-chevron-left" size={24} />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            aria-label={`Scroll ${title} right`}
            className="rounded-full p-1 text-fg-secondary transition hover:bg-surface hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Icon name="mdi-chevron-right" size={24} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex gap-4 overflow-x-auto scrollbar-hide"
      >
        {children}
      </div>
    </section>
  );
}

interface FeaturedAlbumSlideProps {
  album: Album;
}

function FeaturedAlbumSlide({ album }: FeaturedAlbumSlideProps) {
  const { playSongs } = usePlayActions();
  const [loading, setLoading] = useState(false);

  const handlePlay = async () => {
    setLoading(true);
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}`);
      playSongs(detail.songs, 0);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 flex w-full shrink-0 flex-col gap-6 md:flex-row md:items-end">
      <div className="shrink-0 overflow-hidden rounded-2xl shadow-2xl shadow-black/30 md:w-64 lg:w-72">
        <CoverArt
          coverArt={album.coverArt}
          alt={`Cover art for ${album.name}`}
          iconSize={64}
          className="rounded-2xl"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-fg-secondary">
          Featured album
        </span>
        <h1 className="font-display text-4xl font-bold tracking-tight text-fg-primary md:text-5xl lg:text-6xl">
          <Link href={`/albums/${album.id}`} className="hover:text-muted">
            {album.name}
          </Link>
        </h1>
        <p className="text-lg text-fg-secondary">
          {album.artistId ? (
            <Link href={`/artists/${album.artistId}`} className="hover:text-muted">
              {album.artistName ?? 'Unknown artist'}
            </Link>
          ) : (
            album.artistName ?? 'Unknown artist'
          )}
          {album.year !== undefined && album.year !== null && (
            <>
              {' • '}
              <Link href={`/years/${album.year}`} className="hover:text-muted">
                {album.year}
              </Link>
            </>
          )}
          {album.genre && (
            <>
              {' • '}
              <Link href={`/genres/${encodeURIComponent(album.genre)}`} className="hover:text-muted">
                {album.genre}
              </Link>
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePlay}
            disabled={loading}
            className="btn h-12 px-8 text-base"
          >
            <Icon name="mdi-play" size={22} />
            {loading ? 'Loading…' : 'Play'}
          </button>
          <Link
            href={`/albums/${album.id}`}
            className="btn-ghost h-12 px-8 text-base hover:text-fg-primary"
          >
            View album
          </Link>
        </div>
      </div>
    </div>
  );
}

function FeaturedAlbum({ albums }: { albums: Album[] }) {
  const [index, setIndex] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);

  const hasMultiple = albums.length > 1;
  const slides = hasMultiple ? [...albums, albums[0]] : albums;
  const activeDotIndex = index >= albums.length ? 0 : index;
  const album = slides[index];
  const coverUrl = album?.coverArt ? `/api/cover-art/${album.coverArt}` : undefined;
  const dominantColor = useDominantColor(coverUrl);

  useEffect(() => {
    setIndex(0);
    setTransitionEnabled(true);
  }, [albums.map((a) => a.id).join(',')]);

  useEffect(() => {
    if (!hasMultiple) return undefined;
    const timer = setInterval(() => {
      setIndex((current) => (current >= albums.length ? current : current + 1));
    }, 5000);
    return () => clearInterval(timer);
  }, [hasMultiple, albums.length]);

  useEffect(() => {
    if (!hasMultiple || index !== albums.length) return undefined;
    const timeout = setTimeout(() => {
      setTransitionEnabled(false);
      setIndex(0);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitionEnabled(true);
        });
      });
    }, 500);
    return () => clearTimeout(timeout);
  }, [index, albums.length, hasMultiple]);

  if (!album) return null;

  return (
    <section
      className="relative mb-10 overflow-hidden rounded-3xl px-6 pb-10 pt-10"
      style={
        dominantColor
          ? ({
              background: `radial-gradient(circle at 70% 30%, ${dominantColor}22 0%, transparent 60%)`,
              transition: 'background 0.5s ease',
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="overflow-hidden">
        <div
          className={`flex ${
            transitionEnabled ? 'motion-reduce:transition-none transition-transform duration-500 ease-out' : ''
          }`}
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((album, i) => (
            <FeaturedAlbumSlide key={`${album.id}-${i}`} album={album} />
          ))}
        </div>
      </div>
      {hasMultiple && (
        <div className="mt-6 flex items-center gap-2">
          {albums.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to featured album ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === activeDotIndex ? 'w-6 bg-accent' : 'w-2 bg-fg-secondary/40 hover:bg-fg-secondary/70'
              }`}
            />
          ))}
        </div>
      )}
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

  const featuredAlbums = useMemo(() => {
    if (!data) return [];
    const candidates: Album[] = [];
    const seen = new Set<string>();
    const add = (album: Album | undefined) => {
      if (!album || seen.has(album.id)) return;
      seen.add(album.id);
      candidates.push(album);
    };
    add(data.mostPlayed[0]);
    add(data.recentlyPlayed[0]);
    add(data.recentlyAdded[0]);
    add(data.random[0]);
    return candidates;
  }, [data]);

  if (loading) {
    return <p className="p-6 text-sm text-fg-secondary">Loading…</p>;
  }

  if (error) {
    return <p className="p-6 text-sm text-danger">{error}</p>;
  }

  if (!data) {
    return <p className="p-6 text-sm text-fg-secondary">No data available.</p>;
  }

  return (
    <div className="space-y-10 p-6">
      {featuredAlbums.length > 0 && <FeaturedAlbum albums={featuredAlbums} />}

      <Section title="Most played">
        {data.mostPlayed.length === 0 ? (
          <p className="text-sm text-fg-secondary">No played albums yet.</p>
        ) : (
          data.mostPlayed.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} />
            </div>
          ))
        )}
      </Section>

      <Section title="Random albums">
        {data.random.length === 0 ? (
          <p className="text-sm text-fg-secondary">No albums found.</p>
        ) : (
          data.random.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} />
            </div>
          ))
        )}
      </Section>

      <Section title="Recently added">
        {data.recentlyAdded.length === 0 ? (
          <p className="text-sm text-fg-secondary">No recently added albums.</p>
        ) : (
          data.recentlyAdded.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} />
            </div>
          ))
        )}
      </Section>

      <Section title="Recently played">
        {data.recentlyPlayed.length === 0 ? (
          <p className="text-sm text-fg-secondary">No recently played albums.</p>
        ) : (
          data.recentlyPlayed.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} />
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
