import { useState } from 'react';
import { Link } from 'wouter';
import type { StatisticsCharts } from '../../../../types';
import { cn } from '../../../../lib/cn.js';
import { SectionCard } from './SectionCard.js';
import { formatNumber } from './format.js';

const RATING_COLORS = [
  'hsl(var(--chart-6))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-1))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-2))',
];
const UNRATED_COLOR = 'hsl(var(--md-sys-color-on-surface-variant))';

interface DonutSegment {
  key: string;
  count: number;
  rating?: number;
  label: string;
  color: string;
  href: string;
}

export function DonutChart({ distribution, stagger }: { distribution: StatisticsCharts['ratingDistribution']; stagger: number }) {
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
            <span className="text-2xs font-medium uppercase tracking-widest text-on-surface-variant">
              {hovered?.rating ? `${hovered.rating}/5` : hovered?.key === 'unrated' ? 'Unrated' : 'Rated'}
            </span>
            <span className="font-mono text-3xl font-semibold text-on-surface tabular-nums">
              {formatNumber(hoveredInfo.count)}
            </span>
            {hoveredPercentage !== undefined && (
              <span className="font-mono text-2xs text-on-surface-variant tabular-nums">{hoveredPercentage}%</span>
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
                'flex items-center gap-2 rounded-item px-2 py-1.5 text-sm transition hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                hovered && hovered.key !== segment.key ? 'opacity-60' : undefined,
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
              <span className="flex-1 text-on-surface">{segment.label}</span>
              <span className="font-mono text-on-surface-variant tabular-nums">{formatNumber(segment.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
