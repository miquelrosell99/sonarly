import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type {
  OverallStatistics,
  StatisticsCharts,
  StatisticsRatedLists,
  StatisticsTimeRange,
  StatisticsTotals,
  StatisticsTopLists,
  TopYearItem,
  UserStatistics,
} from '@sonarly/shared';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { ArtistImage } from '../../../components/ArtistImage.js';
import { MonthlyActivityChart } from './MonthlyActivityChart.js';
import type { StatisticsMode } from '../hooks/useStatistics.js';

const RANGE_OPTIONS: { value: StatisticsTimeRange; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

function formatListenDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);
  return parts.join(' ');
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatRating(value: number): string {
  const formatted = value.toFixed(1);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
}

function useCollapsed() {
  const [expanded, setExpanded] = useState(false);
  return { expanded, limit: expanded ? 10 : 5, toggle: () => setExpanded((v) => !v) };
}

function ShowMoreButton({ expanded, onClick, count }: { expanded: boolean; onClick: () => void; count: number }) {
  if (count <= 5) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 w-full rounded-lg py-2 text-xs font-medium text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {expanded ? 'Show less' : `Show ${count - 5} more`}
    </button>
  );
}

function AnimatedNumber({ value, formatter = formatNumber }: { value: number; formatter?: (n: number) => string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }

    const duration = 800;
    const start = performance.now();
    const from = display;
    const to = value;
    let raf = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      setDisplay(current);
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span>{formatter(display)}</span>;
}

function StatCard({
  icon,
  label,
  value,
  formatter,
  accent = false,
}: {
  icon: string;
  label: string;
  value: number;
  formatter?: (n: number) => string;
  accent?: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-rule bg-surface p-4 transition hover:border-accent/30">
      <div
        className={cn(
          'mb-3 flex h-10 w-10 items-center justify-center rounded-xl transition',
          accent ? 'bg-accent/10 text-accent' : 'bg-surface-hover text-fg-secondary group-hover:text-accent',
        )}
      >
        <Icon name={icon} size={22} />
      </div>
      <p className="font-display text-3xl font-bold tracking-tight text-fg-primary">
        <AnimatedNumber value={value} formatter={formatter} />
      </p>
      <p className="mt-1 text-sm text-fg-secondary">{label}</p>
    </div>
  );
}

function SummaryCards({ totals }: { totals: StatisticsTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard icon="mdi-play" label="Plays" value={totals.totalPlays} accent />
      <StatCard icon="mdi-clock-outline" label="Listening time" value={totals.totalDurationListened} formatter={formatListenDuration} />
      <StatCard icon="mdi-music" label="Favorite songs" value={totals.favoriteSongs} />
      <StatCard icon="mdi-disc" label="Favorite albums" value={totals.favoriteAlbums} />
      <StatCard icon="mdi-account-star" label="Favorite artists" value={totals.favoriteArtists} />
    </div>
  );
}

function TopSongs({ songs }: { songs: StatisticsTopLists['topSongs'] }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (songs.length === 0) return null;
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-fire" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Top Songs</h3>
      </div>
      <div className="space-y-3">
        {songs.slice(0, limit).map((song, index) => (
          <Link
            key={song.songId}
            href={`/tracks/${song.songId}`}
            className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-hover"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold text-fg-secondary">
              {index + 1}
            </span>
            <CoverArt
              coverArt={song.albumCoverArt}
              alt={song.title}
              className="h-10 w-10 rounded-lg"
              iconSize={20}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-fg-primary">{song.title}</p>
              <p className="truncate text-xs text-fg-secondary">{song.artistName ?? '-'}</p>
            </div>
            <span className="text-sm font-semibold font-mono text-fg-secondary">{formatNumber(song.plays)}</span>
          </Link>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={songs.length} />
    </div>
  );
}

function TopArtists({ artists }: { artists: StatisticsTopLists['topArtists'] }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (artists.length === 0) return null;
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-trophy" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Top Artists</h3>
      </div>
      <div className="space-y-3">
        {artists.slice(0, limit).map((artist, index) => (
          <Link
            key={artist.artistId ?? artist.artistName}
            href={artist.artistId ? `/artists/${artist.artistId}` : '#'}
            className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-hover"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold text-fg-secondary">
              {index + 1}
            </span>
            {artist.artistId ? (
              <ArtistImage
                artistId={artist.artistId}
                alt={artist.artistName}
                className="h-10 w-10"
                shape="circle"
                iconSize={20}
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-hover">
                <Icon name="mdi-account-music" size={20} className="text-fg-secondary" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-fg-primary">{artist.artistName}</p>
            </div>
            <span className="text-sm font-semibold font-mono text-fg-secondary">{formatNumber(artist.plays)}</span>
          </Link>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={artists.length} />
    </div>
  );
}

function TopAlbums({ albums }: { albums: StatisticsTopLists['topAlbums'] }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (albums.length === 0) return null;
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-album" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Top Albums</h3>
      </div>
      <div className="space-y-3">
        {albums.slice(0, limit).map((album, index) => (
          <Link
            key={album.albumId ?? album.albumName}
            href={album.albumId ? `/albums/${album.albumId}` : '#'}
            className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-hover"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold text-fg-secondary">
              {index + 1}
            </span>
            <CoverArt
              coverArt={album.coverArt}
              alt={album.albumName}
              className="h-10 w-10 rounded-lg"
              iconSize={20}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-fg-primary">{album.albumName}</p>
              <p className="truncate text-xs text-fg-secondary">{album.artistName ?? '-'}</p>
            </div>
            <span className="text-sm font-semibold font-mono text-fg-secondary">{formatNumber(album.plays)}</span>
          </Link>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={albums.length} />
    </div>
  );
}

function GenreChart({ genres }: { genres: StatisticsTopLists['topGenres'] }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (genres.length === 0) return null;
  const max = Math.max(...genres.map((g) => g.plays));
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-chart-pie" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Top Genres</h3>
      </div>
      <div className="space-y-3">
        {genres.slice(0, limit).map((genre) => (
          <div key={genre.genre} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-fg-primary">{genre.genre}</span>
              <span className="font-mono text-fg-secondary">{formatNumber(genre.plays)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full rounded-full bg-accent transition-all duration-700 ease-out motion-reduce:transition-none"
                style={{ width: `${max > 0 ? (genre.plays / max) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={genres.length} />
    </div>
  );
}

function TopPlayedYears({ years }: { years: TopYearItem[] }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (years.length === 0) return null;
  const max = Math.max(...years.map((y) => y.plays));
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-calendar-clock" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Top Years</h3>
      </div>
      <div className="space-y-3">
        {years.slice(0, limit).map((year) => (
          <Link
            key={year.year}
            href={`/years/${year.year}`}
            className="flex items-center justify-between gap-3 rounded-xl p-2 transition hover:bg-surface-hover"
          >
            <span className="font-medium text-fg-primary">{year.year}</span>
            <div className="flex items-center gap-3">
              <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-700 ease-out motion-reduce:transition-none"
                  style={{ width: `${max > 0 ? (year.plays / max) * 100 : 0}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm font-mono text-fg-secondary">{formatNumber(year.plays)}</span>
            </div>
          </Link>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={years.length} />
    </div>
  );
}

const RATING_COLORS = [
  'hsl(var(--chart-6))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-1))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-2))',
];
const UNRATED_COLOR = 'hsl(var(--fg-secondary))';

interface DonutSegment {
  key: string;
  count: number;
  rating?: number;
  label: string;
  color: string;
  href: string;
}

function DonutChart({ distribution }: { distribution: StatisticsCharts['ratingDistribution'] }) {
  const { ratings, unrated } = distribution;
  const ratedTotal = ratings.reduce((sum, item) => sum + item.count, 0);
  const [hovered, setHovered] = useState<DonutSegment | null>(null);
  if (ratedTotal === 0 && unrated === 0) return null;

  const segments: DonutSegment[] = ratings
    .map((item) => ({
      key: `rating-${item.rating}`,
      count: item.count,
      rating: item.rating,
      label: `${item.rating} star${item.rating === 1 ? '' : 's'}`,
      color: RATING_COLORS[item.rating - 1] ?? RATING_COLORS[0],
      href: `/tracks?rating=${item.rating}`,
    }))
    .filter((s) => s.count > 0);

  const unratedSegment: DonutSegment | null =
    unrated > 0
      ? {
          key: 'unrated',
          count: unrated,
          label: 'Unrated',
          color: UNRATED_COLOR,
          href: '/tracks?unrated=true',
        }
      : null;

  const allSegments = unratedSegment ? [...segments, unratedSegment] : segments;
  const totalForArc = ratedTotal + (unratedSegment?.count ?? 0);

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const hoveredInfo = hovered ?? {
    key: 'total',
    count: ratedTotal,
    label: 'Rated',
    color: 'transparent',
    href: '#',
  };
  const hoveredPercentage =
    hovered && totalForArc > 0 ? Math.round((hovered.count / totalForArc) * 100) : undefined;

  const chartSummary = `Rating distribution: ${allSegments
    .map((segment) => `${segment.label}: ${segment.count}`)
    .join(', ')}`;

  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-star" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Rating Distribution</h3>
      </div>
      <div className="flex items-center justify-center">
        <div className="relative h-48 w-48" role="img" aria-label={chartSummary}>
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
            {allSegments.map((segment) => {
              const segmentLength = (segment.count / totalForArc) * circumference;
              const dashArray = `${segmentLength} ${circumference - segmentLength}`;
              const circle = (
                <Link key={segment.key} href={segment.href} tabIndex={-1}>
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={hovered?.key === segment.key ? 18 : 12}
                    strokeDasharray={dashArray}
                    strokeDashoffset={-offset}
                    className="cursor-pointer transition-all duration-300 ease-out motion-reduce:transition-none"
                    onMouseEnter={() => setHovered(segment)}
                    onMouseLeave={() => setHovered(null)}
                  />
                </Link>
              );
              offset += segmentLength;
              return circle;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {hovered?.rating ? (
              <span className="text-sm font-medium text-fg-primary">{hovered.rating}/5</span>
            ) : hovered?.key === 'unrated' ? (
              <span className="text-sm font-medium text-fg-primary">Unrated</span>
            ) : (
              <span className="text-[10px] text-fg-secondary">Rated</span>
            )}
            <span className="font-mono text-2xl font-bold text-fg-primary">{formatNumber(hoveredInfo.count)}</span>
            {hoveredPercentage !== undefined && (
              <span className="text-[10px] text-fg-secondary">{hoveredPercentage}%</span>
            )}
          </div>
        </div>
      </div>
      <ul className="mt-4 space-y-1">
        {allSegments.map((segment) => (
          <li key={segment.key}>
            <Link
              href={segment.href}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
              <span className="flex-1 text-fg-primary">{segment.label}</span>
              <span className="font-mono text-fg-secondary">{formatNumber(segment.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopRatedArtists({ artists }: { artists: StatisticsRatedLists['topRatedArtists'] }) {
  const { expanded, limit, toggle } = useCollapsed();
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-account-star" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Top Rated Artists</h3>
      </div>
      {artists.length === 0 ? (
        <p className="text-sm text-fg-secondary">Rate at least 2 songs by an artist to see this list.</p>
      ) : (
        <>
          <div className="space-y-3">
            {artists.slice(0, limit).map((artist, index) => (
              <Link
                key={artist.artistId ?? artist.artistName}
                href={artist.artistId ? `/artists/${artist.artistId}` : '#'}
                className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-hover"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold text-fg-secondary">
                  {index + 1}
                </span>
                {artist.artistId ? (
                  <ArtistImage
                    artistId={artist.artistId}
                    alt={artist.artistName}
                    className="h-10 w-10"
                    shape="circle"
                    iconSize={20}
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-hover">
                    <Icon name="mdi-account-music" size={20} className="text-fg-secondary" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg-primary">{artist.artistName}</p>
                  <p className="truncate text-xs text-fg-secondary">{formatNumber(artist.ratedSongs)} rated songs</p>
                </div>
                <span className="text-sm font-semibold font-mono text-fg-secondary">{formatRating(artist.averageRating)}/5</span>
              </Link>
            ))}
          </div>
          <ShowMoreButton expanded={expanded} onClick={toggle} count={artists.length} />
        </>
      )}
    </div>
  );
}

function TopRatedGenres({ genres }: { genres: StatisticsRatedLists['topRatedGenres'] }) {
  const { expanded, limit, toggle } = useCollapsed();
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-tag-multiple" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Top Rated Genres</h3>
      </div>
      {genres.length === 0 ? (
        <p className="text-sm text-fg-secondary">Rate at least 2 songs in a genre to see this list.</p>
      ) : (
        <>
          <div className="space-y-3">
            {genres.slice(0, limit).map((genre, index) => (
              <Link
                key={genre.genre}
                href={`/genres/${encodeURIComponent(genre.genre)}`}
                className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-hover"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold text-fg-secondary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg-primary">{genre.genre}</p>
                  <p className="truncate text-xs text-fg-secondary">{formatNumber(genre.ratedSongs)} rated songs</p>
                </div>
                <span className="text-sm font-semibold font-mono text-fg-secondary">{formatRating(genre.averageRating)}/5</span>
              </Link>
            ))}
          </div>
          <ShowMoreButton expanded={expanded} onClick={toggle} count={genres.length} />
        </>
      )}
    </div>
  );
}

function TopRatedYears({ years }: { years: StatisticsRatedLists['topRatedYears'] }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (years.length === 0) return null;
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="mdi-calendar-clock" size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold text-fg-primary">Top Rated Years</h3>
      </div>
      <div className="space-y-3">
        {years.slice(0, limit).map((year, index) => (
          <Link
            key={year.year}
            href={`/years/${year.year}`}
            className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-hover"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold text-fg-secondary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-fg-primary">{year.year}</p>
              <p className="truncate text-xs text-fg-secondary">{formatNumber(year.ratedSongs)} rated songs</p>
            </div>
            <span className="text-sm font-semibold font-mono text-fg-secondary">{formatRating(year.averageRating)}/5</span>
          </Link>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={years.length} />
    </div>
  );
}

export interface StatisticsViewProps {
  data?: UserStatistics | OverallStatistics;
  range: StatisticsTimeRange;
  onRangeChange: (range: StatisticsTimeRange) => void;
  title?: string;
  subtitle?: string;
  isLoading?: boolean;
  error?: Error | null;
  mode?: StatisticsMode;
  userId?: string;
}

export function StatisticsView({
  data,
  range,
  onRangeChange,
  title,
  subtitle,
  isLoading,
  error,
  mode = 'me',
  userId,
}: StatisticsViewProps) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-surface" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-sm text-danger">{error?.message ?? 'Statistics could not be loaded.'}</p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {title && <h2 className="font-display text-2xl font-bold tracking-tight text-fg-primary">{title}</h2>}
          {subtitle && <p className="text-sm text-fg-secondary">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onRangeChange(option.value)}
              aria-pressed={range === option.value}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                range === option.value
                  ? 'bg-accent text-bg-primary'
                  : 'border border-rule bg-surface text-fg-primary hover:bg-surface-hover',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <SummaryCards totals={data.totals} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MonthlyActivityChart
          monthlyPlays={data.monthlyPlays}
          mode={mode}
          userId={userId}
          range={range}
        />
        <DonutChart distribution={data.charts.ratingDistribution} />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <TopSongs songs={data.top.topSongs} />
        <TopArtists artists={data.top.topArtists} />
        <TopAlbums albums={data.top.topAlbums} />
        <GenreChart genres={data.top.topGenres} />
        <TopPlayedYears years={data.top.topYears} />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <TopRatedArtists artists={data.rated.topRatedArtists} />
        <TopRatedGenres genres={data.rated.topRatedGenres} />
        <TopRatedYears years={data.rated.topRatedYears} />
      </div>
    </div>
  );
}
