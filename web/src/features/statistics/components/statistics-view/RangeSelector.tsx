import type { StatisticsTimeRange } from '../../../../types';
import { cn } from '../../../../lib/cn.js';

const RANGE_OPTIONS: { value: StatisticsTimeRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: 'Year' },
  { value: 'all', label: 'All time' },
];

export function RangeSelector({
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
      className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-input border border-outline bg-surface p-1 scrollbar-hide"
    >
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onRangeChange(option.value)}
          aria-pressed={range === option.value}
          className={cn(
            'h-10 shrink-0 rounded-input px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            range === option.value
              ? 'bg-primary-container text-on-primary-container'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
