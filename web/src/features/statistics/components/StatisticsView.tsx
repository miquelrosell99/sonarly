import type { StatisticsTimeRange, UserStatistics, OverallStatistics } from '../../../types';
import { MonthlyActivityChart } from './MonthlyActivityChart.js';
import type { StatisticsMode } from '../hooks/useStatistics.js';
import {
  DonutChart,
  GenreChart,
  HeroStats,
  RangeSelector,
  TopAlbums,
  TopArtists,
  TopPlayedYears,
  TopRatedArtists,
  TopRatedGenres,
  TopRatedYears,
  TopSongs,
  staggerStyle,
} from './statistics-view/index.js';
import '../statistics.css';

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
          <div className="h-8 w-48 animate-pulse rounded-item bg-surface" />
          <div className="h-12 w-64 animate-pulse rounded-full bg-surface" />
        </div>
        <div className="h-64 animate-pulse rounded-card bg-surface" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-card bg-surface" />
          <div className="h-72 animate-pulse rounded-card bg-surface" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 min-[1280px]:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-80 animate-pulse rounded-card bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-sm text-error">{error?.message ?? 'Statistics could not be loaded.'}</p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="stat-reveal flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" style={staggerStyle(0)}>
        <div>
          {title && <h1 className="font-display text-2xl font-semibold tracking-tight text-on-surface">{title}</h1>}
          {subtitle && <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p>}
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 min-[1280px]:grid-cols-3">
        <TopSongs songs={data.top.topSongs} stagger={2} />
        <TopArtists artists={data.top.topArtists} stagger={3} />
        <TopAlbums albums={data.top.topAlbums} stagger={4} />
        <GenreChart genres={data.top.topGenres} stagger={5} />
        <TopPlayedYears years={data.top.topYears} stagger={6} />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 min-[1280px]:grid-cols-3">
        <TopRatedArtists artists={data.rated.topRatedArtists} stagger={7} />
        <TopRatedGenres genres={data.rated.topRatedGenres} stagger={8} />
        <TopRatedYears years={data.rated.topRatedYears} stagger={9} />
      </div>
    </div>
  );
}
