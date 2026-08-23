import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
import '../statistics.css';

const RANGE_OPTIONS: { value: StatisticsTimeRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: 'Year' },
  { value: 'all', label: 'All time' },
];

function staggerStyle(index: number): CSSProperties {
  return { '--stagger': index } as CSSProperties;
}

function formatListenDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
  } else if (hours > 0) {
    parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
  } else if (minutes > 0) {
    parts.push(`${minutes}m`);
  } else {
    parts.push(`${Math.floor(seconds)}s`);
  }
  return parts.join(' ');
}

function formatListenDurationLong(seconds: number): string {
  if (seconds <= 0) return 'no listening time yet';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (days === 0 && hours === 0 && minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  }
  if (parts.length === 0) parts.push(`${Math.floor(seconds)} seconds`);
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
      className="mt-3 flex h-11 w-full items-center justify-center rounded-xl text-xs font-medium text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

    const duration = 900;
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

function SectionCard({
  icon,
  title,
  stagger,
  children,
  className,
}: {
  icon: string;
  title: string;
  stagger: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('stat-reveal rounded-2xl border border-rule bg-surface p-4 sm:p-5', className)}
      style={staggerStyle(stagger)}
    >
      <div className="mb-4 flex items-center gap-2">
        <Icon name={icon} size={20} className="text-accent" />
        <h3 className="font-display text-lg font-bold tracking-tight text-fg-primary">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function RangeSelector({
  range,
  onRangeChange,
}: {
  range: StatisticsTimeRange;
  onRangeChange: (range: StatisticsTimeRange) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-rule bg-surface p-1 scrollbar-hide"
    >
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onRangeChange(option.value)}
          aria-pressed={range === option.value}
          className={cn(
            'h-10 shrink-0 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            range === option.value
              ? 'bg-accent text-bg-primary shadow-sm'
              : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function HeroStat({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-fg-secondary">
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0">
        <p className="font-display text-2xl font-bold tracking-tight text-fg-primary tabular-nums">
          <AnimatedNumber value={value} />
        </p>
        <p className="mt-0.5 truncate text-xs text-fg-secondary">{label}</p>
      </div>
    </div>
  );
}

function HeroStats({ totals }: { totals: StatisticsTotals }) {
  const seconds = totals.totalDurationListened;
  return (
    <section
      aria-label="Listening summary"
      className="stat-reveal relative overflow-hidden rounded-2xl border border-rule bg-surface p-6 sm:p-8"
      style={staggerStyle(0)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--chart-5) / 0.15), transparent)' }}
      />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Listening time</p>
        <p className="mt-3 bg-gradient-to-r from-fg-primary via-fg-primary to-accent bg-clip-text font-display text-5xl font-bold tracking-tight text-transparent tabular-nums sm:text-6xl">
          <AnimatedNumber value={seconds} formatter={formatListenDuration} />
        </p>
        <p className="mt-2 text-sm text-fg-secondary">
          {formatListenDurationLong(seconds)}
          {totals.totalPlays > 0 ? ` across ${formatNumber(totals.totalPlays)} plays` : ''}
        </p>
        <div className="mt-8 grid grid-cols-1 gap-x-4 gap-y-5 border-t border-rule pt-6 min-[420px]:grid-cols-2 lg:grid-cols-4">
          <HeroStat icon="mdi-play" label="Plays" value={totals.totalPlays} />
          <HeroStat icon="mdi-music" label="Favorite songs" value={totals.favoriteSongs} />
          <HeroStat icon="mdi-disc" label="Favorite albums" value={totals.favoriteAlbums} />
          <HeroStat icon="mdi-account-star" label="Favorite artists" value={totals.favoriteArtists} />
        </div>
      </div>
    </section>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'relative w-6 shrink-0 text-center font-mono text-sm font-semibold tabular-nums',
        rank <= 3 ? 'text-accent' : 'text-fg-secondary',
      )}
    >
      {rank}
    </span>
  );
}

function TopListRow({
  href,
  rank,
  proportion,
  title,
  subtitle,
  image,
  value,
}: {
  href: string;
  rank: number;
  proportion: number;
  title: string;
  subtitle?: string;
  image: ReactNode;
  value: string;
}) {
  return (
    <Link
      href={href}
      className="group/row relative flex items-center gap-3 overflow-hidden rounded-xl p-2 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-xl bg-accent/[0.07]"
        style={{ width: `${Math.max(0, Math.min(100, proportion * 100))}%` }}
      />
      <RankBadge rank={rank} />
      {image}
      <div className="relative min-w-0 flex-1">
        <p className="truncate font-medium text-fg-primary">{title}</p>
        {subtitle && <p className="truncate text-xs text-fg-secondary">{subtitle}</p>}
      </div>
      <span className="relative font-mono text-sm font-semibold text-fg-secondary tabular-nums transition group-hover/row:text-fg-primary">
        {value}
      </span>
    </Link>
  );
}

function TopSongs({ songs, stagger }: { songs: StatisticsTopLists['topSongs']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (songs.length === 0) return null;
  const max = Math.max(...songs.map((s) => s.plays));
  return (
    <SectionCard icon="mdi-fire" title="Top Songs" stagger={stagger}>
      <div className="space-y-1">
        {songs.slice(0, limit).map((song, index) => (
          <TopListRow
            key={song.songId}
            href={`/tracks/${song.songId}`}
            rank={index + 1}
            proportion={max > 0 ? song.plays / max : 0}
            title={song.title}
            subtitle={song.artistName ?? '-'}
            image={
              <CoverArt
                coverArt={song.albumCoverArt}
                alt={song.title}
                className="relative h-10 w-10 rounded-lg"
                iconSize={20}
              />
            }
            value={formatNumber(song.plays)}
          />
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={songs.length} />
    </SectionCard>
  );
}

function ArtistAvatar({ artistId, artistName }: { artistId?: string; artistName: string }) {
  if (artistId) {
    return (
      <ArtistImage
        artistId={artistId}
        alt={artistName}
        className="relative h-10 w-10"
        shape="circle"
        iconSize={20}
      />
    );
  }
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-hover">
      <Icon name="mdi-account-music" size={20} className="text-fg-secondary" />
    </div>
  );
}

function TopArtists({ artists, stagger }: { artists: StatisticsTopLists['topArtists']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (artists.length === 0) return null;
  const max = Math.max(...artists.map((a) => a.plays));
  return (
    <SectionCard icon="mdi-trophy" title="Top Artists" stagger={stagger}>
      <div className="space-y-1">
        {artists.slice(0, limit).map((artist, index) => (
          <TopListRow
            key={artist.artistId ?? artist.artistName}
            href={artist.artistId ? `/artists/${artist.artistId}` : '#'}
            rank={index + 1}
            proportion={max > 0 ? artist.plays / max : 0}
            title={artist.artistName}
            image={<ArtistAvatar artistId={artist.artistId} artistName={artist.artistName} />}
            value={formatNumber(artist.plays)}
          />
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={artists.length} />
    </SectionCard>
  );
}

function TopAlbums({ albums, stagger }: { albums: StatisticsTopLists['topAlbums']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (albums.length === 0) return null;
  const max = Math.max(...albums.map((a) => a.plays));
  return (
    <SectionCard icon="mdi-album" title="Top Albums" stagger={stagger}>
      <div className="space-y-1">
        {albums.slice(0, limit).map((album, index) => (
          <TopListRow
            key={album.albumId ?? album.albumName}
            href={album.albumId ? `/albums/${album.albumId}` : '#'}
            rank={index + 1}
            proportion={max > 0 ? album.plays / max : 0}
            title={album.albumName}
            subtitle={album.artistName ?? '-'}
            image={
              <CoverArt
                coverArt={album.coverArt}
                alt={album.albumName}
                className="relative h-10 w-10 rounded-lg"
                iconSize={20}
              />
            }
            value={formatNumber(album.plays)}
          />
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={albums.length} />
    </SectionCard>
  );
}

function GenreChart({ genres, stagger }: { genres: StatisticsTopLists['topGenres']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (genres.length === 0) return null;
  const max = Math.max(...genres.map((g) => g.plays));
  return (
    <SectionCard icon="mdi-chart-pie" title="Top Genres" stagger={stagger}>
      <div className="space-y-1">
        {genres.slice(0, limit).map((genre, index) => (
          <div key={genre.genre} className="group -mx-2 space-y-1.5 rounded-xl px-2 py-2 transition hover:bg-surface-hover">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-fg-primary">{genre.genre}</span>
              <span className="font-mono text-fg-secondary tabular-nums transition group-hover:text-fg-primary">
                {formatNumber(genre.plays)}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className="stat-grow-x h-full rounded-full transition group-hover:brightness-110"
                style={{
                  width: `${max > 0 ? (genre.plays / max) * 100 : 0}%`,
                  background: 'linear-gradient(90deg, hsl(var(--accent) / 0.55), hsl(var(--accent)))',
                  ...staggerStyle(index),
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={genres.length} />
    </SectionCard>
  );
}

function TopPlayedYears({ years, stagger }: { years: TopYearItem[]; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (years.length === 0) return null;
  const max = Math.max(...years.map((y) => y.plays));
  return (
    <SectionCard icon="mdi-calendar-clock" title="Top Years" stagger={stagger}>
      <div className="space-y-1">
        {years.slice(0, limit).map((year, index) => (
          <Link
            key={year.year}
            href={`/years/${year.year}`}
            className="group flex items-center justify-between gap-3 rounded-xl p-2 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="font-mono font-medium text-fg-primary tabular-nums">{year.year}</span>
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-24 overflow-hidden rounded-full bg-surface-hover sm:w-32">
                <div
                  className="stat-grow-x h-full rounded-full transition group-hover:brightness-110"
                  style={{
                    width: `${max > 0 ? (year.plays / max) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, hsl(var(--accent) / 0.55), hsl(var(--accent)))',
                    ...staggerStyle(index),
                  }}
                />
              </div>
              <span className="w-10 text-right font-mono text-sm text-fg-secondary tabular-nums transition group-hover:text-fg-primary">
                {formatNumber(year.plays)}
              </span>
            </div>
          </Link>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={years.length} />
    </SectionCard>
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

function DonutChart({ distribution, stagger }: { distribution: StatisticsCharts['ratingDistribution']; stagger: number }) {
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
    <SectionCard icon="mdi-star" title="Rating Distribution" stagger={stagger}>
      <div className="flex items-center justify-center">
        <div className="relative h-48 w-48" role="img" aria-label={chartSummary}>
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
            {allSegments.map((segment) => {
              const segmentLength = (segment.count / totalForArc) * circumference;
              const dashArray = `${segmentLength} ${circumference - segmentLength}`;
              const isHovered = hovered?.key === segment.key;
              const circle = (
                <Link key={segment.key} href={segment.href} tabIndex={-1}>
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={isHovered ? 18 : 12}
                    strokeDasharray={dashArray}
                    strokeDashoffset={-offset}
                    opacity={hovered && !isHovered ? 0.25 : 1}
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
            <span className="text-[10px] font-medium uppercase tracking-widest text-fg-secondary">
              {hovered?.rating ? `${hovered.rating}/5` : hovered?.key === 'unrated' ? 'Unrated' : 'Rated'}
            </span>
            <span className="font-mono text-3xl font-bold text-fg-primary tabular-nums">
              {formatNumber(hoveredInfo.count)}
            </span>
            {hoveredPercentage !== undefined && (
              <span className="font-mono text-[10px] text-fg-secondary tabular-nums">{hoveredPercentage}%</span>
            )}
          </div>
        </div>
      </div>
      <ul className="mt-4 space-y-1">
        {allSegments.map((segment) => (
          <li key={segment.key}>
            <Link
              href={segment.href}
              onMouseEnter={() => setHovered(segment)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                hovered && hovered.key !== segment.key ? 'opacity-60' : undefined,
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
              <span className="flex-1 text-fg-primary">{segment.label}</span>
              <span className="font-mono text-fg-secondary tabular-nums">{formatNumber(segment.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-fg-secondary">{children}</p>;
}

function TopRatedArtists({ artists, stagger }: { artists: StatisticsRatedLists['topRatedArtists']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  const max = artists.length > 0 ? Math.max(...artists.map((a) => a.ratedSongs)) : 0;
  return (
    <SectionCard icon="mdi-account-star" title="Top Rated Artists" stagger={stagger}>
      {artists.length === 0 ? (
        <EmptyHint>Rate at least 2 songs by an artist to see this list.</EmptyHint>
      ) : (
        <>
          <div className="space-y-1">
            {artists.slice(0, limit).map((artist, index) => (
              <TopListRow
                key={artist.artistId ?? artist.artistName}
                href={artist.artistId ? `/artists/${artist.artistId}` : '#'}
                rank={index + 1}
                proportion={max > 0 ? artist.ratedSongs / max : 0}
                title={artist.artistName}
                subtitle={`${formatNumber(artist.ratedSongs)} rated songs`}
                image={<ArtistAvatar artistId={artist.artistId} artistName={artist.artistName} />}
                value={`${formatRating(artist.averageRating)}/5`}
              />
            ))}
          </div>
          <ShowMoreButton expanded={expanded} onClick={toggle} count={artists.length} />
        </>
      )}
    </SectionCard>
  );
}

function TopRatedGenres({ genres, stagger }: { genres: StatisticsRatedLists['topRatedGenres']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  const max = genres.length > 0 ? Math.max(...genres.map((g) => g.ratedSongs)) : 0;
  return (
    <SectionCard icon="mdi-tag-multiple" title="Top Rated Genres" stagger={stagger}>
      {genres.length === 0 ? (
        <EmptyHint>Rate at least 2 songs in a genre to see this list.</EmptyHint>
      ) : (
        <>
          <div className="space-y-1">
            {genres.slice(0, limit).map((genre, index) => (
              <TopListRow
                key={genre.genre}
                href={`/genres/${encodeURIComponent(genre.genre)}`}
                rank={index + 1}
                proportion={max > 0 ? genre.ratedSongs / max : 0}
                title={genre.genre}
                subtitle={`${formatNumber(genre.ratedSongs)} rated songs`}
                image={
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
                    <Icon name="mdi-tag" size={20} className="text-fg-secondary" />
                  </span>
                }
                value={`${formatRating(genre.averageRating)}/5`}
              />
            ))}
          </div>
          <ShowMoreButton expanded={expanded} onClick={toggle} count={genres.length} />
        </>
      )}
    </SectionCard>
  );
}

function TopRatedYears({ years, stagger }: { years: StatisticsRatedLists['topRatedYears']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (years.length === 0) return null;
  const max = Math.max(...years.map((y) => y.ratedSongs));
  return (
    <SectionCard icon="mdi-calendar-clock" title="Top Rated Years" stagger={stagger}>
      <div className="space-y-1">
        {years.slice(0, limit).map((year, index) => (
          <TopListRow
            key={year.year}
            href={`/years/${year.year}`}
            rank={index + 1}
            proportion={max > 0 ? year.ratedSongs / max : 0}
            title={String(year.year)}
            subtitle={`${formatNumber(year.ratedSongs)} rated songs`}
            image={
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
                <Icon name="mdi-calendar-clock" size={20} className="text-fg-secondary" />
              </span>
            }
            value={`${formatRating(year.averageRating)}/5`}
          />
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={years.length} />
    </SectionCard>
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
      <div className="space-y-6" aria-busy="true" aria-label="Loading statistics">
        <div className="flex items-center justify-between gap-4">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-surface" />
          <div className="h-12 w-64 animate-pulse rounded-full bg-surface" />
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-surface" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-2xl bg-surface" />
          <div className="h-72 animate-pulse rounded-2xl bg-surface" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-80 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
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
      <div className="stat-reveal flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" style={staggerStyle(0)}>
        <div>
          {title && <h2 className="font-display text-2xl font-bold tracking-tight text-fg-primary">{title}</h2>}
          {subtitle && <p className="mt-1 text-sm text-fg-secondary">{subtitle}</p>}
        </div>
        <RangeSelector range={range} onRangeChange={onRangeChange} />
      </div>

      <HeroStats totals={data.totals} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="stat-reveal" style={staggerStyle(1)}>
          <MonthlyActivityChart
            monthlyPlays={data.monthlyPlays}
            mode={mode}
            userId={userId}
            range={range}
          />
        </div>
        <DonutChart distribution={data.charts.ratingDistribution} stagger={2} />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <TopSongs songs={data.top.topSongs} stagger={2} />
        <TopArtists artists={data.top.topArtists} stagger={3} />
        <TopAlbums albums={data.top.topAlbums} stagger={4} />
        <GenreChart genres={data.top.topGenres} stagger={5} />
        <TopPlayedYears years={data.top.topYears} stagger={6} />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <TopRatedArtists artists={data.rated.topRatedArtists} stagger={7} />
        <TopRatedGenres genres={data.rated.topRatedGenres} stagger={8} />
        <TopRatedYears years={data.rated.topRatedYears} stagger={9} />
      </div>
    </div>
  );
}
