import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Album } from '../../../../types';
import { api } from '../../../../lib/api.js';
import { Icon } from '../../../../components/ui/Icon.js';
import { Button } from '../../../../components/ui/button.js';
import { CoverArt } from '../../../../components/CoverArt.js';
import { usePlayActions } from '../../../../hooks/usePlayActions.js';
import { useDominantColor } from '../../../../hooks/useDominantColor.js';
import { useLibraryStore, buildLibraryQuery } from '../../../../stores/libraryStore.js';
import type { AlbumDetail } from './types.js';

interface FeaturedAlbumSlideProps {
  album: Album;
  active: boolean;
}

function FeaturedAlbumSlide({ album, active }: FeaturedAlbumSlideProps) {
  const { playSongs } = usePlayActions();
  const [loading, setLoading] = useState(false);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const handlePlay = async () => {
    setLoading(true);
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      playSongs(detail.songs, undefined, undefined, { type: 'album', id: album.id });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={(el) => el?.toggleAttribute('inert', !active)}
      aria-hidden={!active || undefined}
      className="relative z-10 flex w-full min-w-0 shrink-0 flex-col gap-4 md:flex-row md:items-start md:gap-6"
    >
      <div className="w-40 shrink-0 overflow-hidden rounded-card sm:w-52 md:w-64 lg:w-72">
        <CoverArt
          coverArt={album.coverArt}
          alt={`Cover art for ${album.name}`}
          iconSize={64}
          className="rounded-card"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <h3
          className="line-clamp-2 break-words font-display text-2xl font-semibold tracking-tight text-on-surface sm:text-4xl md:text-5xl lg:text-6xl"
          title={album.name}
        >
          <Link href={`/albums/${album.id}`} className="hover:text-on-surface-variant">
            {album.name}
          </Link>
        </h3>
        <p className="truncate text-base text-on-surface-variant sm:text-lg">
          {album.artistId ? (
            <Link href={`/artists/${album.artistId}`} className="hover:text-on-surface-variant">
              {album.artistName ?? 'Unknown artist'}
            </Link>
          ) : (
            album.artistName ?? 'Unknown artist'
          )}
          {album.year !== undefined && album.year !== null && (
            <>
              {' • '}
              <Link href={`/years/${album.year}`} className="hover:text-on-surface-variant">
                {album.year}
              </Link>
            </>
          )}
          {album.genre && (
            <>
              {' • '}
              <Link href={`/genres/${encodeURIComponent(album.genre)}`} className="hover:text-on-surface-variant">
                {album.genre}
              </Link>
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handlePlay} disabled={loading} size="lg">
            <Icon name="mdi-play" size={22} />
            {loading ? 'Loading…' : 'Play'}
          </Button>
          <Button variant="ghost" size="lg" asChild>
            <Link href={`/albums/${album.id}`}>View album</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function FeaturedAlbum({ albums }: { albums: Album[] }) {
  const [index, setIndex] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const hasMultiple = albums.length > 1;
  const slides = hasMultiple ? [...albums, albums[0]] : albums;
  const activeDotIndex = index >= albums.length ? 0 : index;
  const album = slides[index];
  const coverUrl = album?.coverArt ? `/api/cover-art/${album.coverArt}` : undefined;
  const dominantColor = useDominantColor(coverUrl);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setReducedMotion(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    setIndex(0);
    setTransitionEnabled(true);
  }, [albums.map((a) => a.id).join(',')]);

  useEffect(() => {
    if (!hasMultiple || paused || reducedMotion) return undefined;
    const timer = setInterval(() => {
      setIndex((current) => (current >= albums.length ? current : current + 1));
    }, 5000);
    return () => clearInterval(timer);
  }, [hasMultiple, albums.length, paused, reducedMotion]);

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
    <div className="mb-8">
      <h2 className="mb-4 font-display text-xl font-semibold tracking-tight">Featured albums</h2>
      <section
        aria-roledescription="carousel"
        aria-label="Featured albums"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="relative overflow-hidden rounded-card p-4 sm:p-6"
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
            <FeaturedAlbumSlide key={`${album.id}-${i}`} album={album} active={i === index} />
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
              className="group flex h-11 w-11 items-center justify-center rounded-full"
            >
              <span
                className={`h-2 rounded-full transition-all ${
                  i === activeDotIndex ? 'w-6 bg-primary' : 'w-2 bg-on-surface-variant/40 group-hover:bg-on-surface-variant/70'
                }`}
              />
            </button>
          ))}
        </div>
      )}
      </section>
    </div>
  );
}
