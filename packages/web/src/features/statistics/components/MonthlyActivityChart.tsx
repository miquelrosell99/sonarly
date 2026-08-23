import { useMemo, useState, type CSSProperties } from 'react';
import type {
  MonthlyGroupedPlaysItem,
  MonthlyPlaysGroupBy,
  StatisticsMonthlyPlaysItem,
  StatisticsTimeRange,
} from '@sonarly/shared';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Modal } from '../../../components/ui/Modal.js';
import { useMonthlyGroupedPlays, type StatisticsMode } from '../hooks/useStatistics.js';

const GROUP_BY_OPTIONS: { value: MonthlyPlaysGroupBy | 'total'; label: string }[] = [
  { value: 'total', label: 'Total' },
  { value: 'artist', label: 'Artist' },
  { value: 'genre', label: 'Genre' },
  { value: 'year', label: 'Year' },
  { value: 'rating', label: 'Rating' },
  { value: 'favorite', label: 'Favorite' },
];

const CHART_CSS_VARS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
  '--chart-9',
  '--chart-10',
];

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatMonthLabel(month: string): string {
  const [year, mon] = month.split('-');
  const date = new Date(Number(year), Number(mon) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatShortMonth(month: string): string {
  const [year, mon] = month.split('-');
  const date = new Date(Number(year), Number(mon) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short' });
}

function getGroupColor(index: number): string {
  return `hsl(var(${CHART_CSS_VARS[index % CHART_CSS_VARS.length]}))`;
}

interface ChartDataItem {
  month: string;
  total: number;
  groups: { key: string; plays: number; color: string; gradient?: boolean }[];
}

function buildSimpleData(monthlyPlays: StatisticsMonthlyPlaysItem[]): ChartDataItem[] {
  return monthlyPlays.map((item) => ({
    month: item.month,
    total: item.plays,
    groups: [{ key: 'Plays', plays: item.plays, color: 'hsl(var(--accent))', gradient: true }],
  }));
}

function buildGroupedData(grouped: MonthlyGroupedPlaysItem[]): ChartDataItem[] {
  const allKeys = Array.from(
    new Set(grouped.flatMap((item) => item.groups.map((g) => g.key))),
  );
  const keyColorIndex = new Map<string, number>();
  allKeys.forEach((key, index) => keyColorIndex.set(key, index));

  return grouped.map((item) => ({
    month: item.month,
    total: item.groups.reduce((sum, g) => sum + g.plays, 0),
    groups: item.groups.map((g) => ({
      key: g.key,
      plays: g.plays,
      color: getGroupColor(keyColorIndex.get(g.key) ?? 0),
    })),
  }));
}

function BarStack({
  data,
  max,
  size,
  showLabels = false,
  stagger = 0,
  selected = false,
  onSelect,
}: {
  data: ChartDataItem;
  max: number;
  size: 'sm' | 'lg';
  showLabels?: boolean;
  stagger?: number;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const heightPercent = max > 0 ? (data.total / max) * 100 : 0;
  const displayHeight = Math.max(heightPercent, 2);

  return (
    <div className={`group/bar flex flex-1 flex-col justify-end ${size === 'lg' ? 'gap-2' : 'gap-1'} min-w-0`}>
      {showLabels && (
        <div className="text-center">
          <span className="font-mono text-xs font-semibold text-fg-primary tabular-nums">{formatNumber(data.total)}</span>
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${formatMonthLabel(data.month)}: ${formatNumber(data.total)} plays`}
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onSelect?.();
          }
        }}
        className={`relative w-full cursor-pointer rounded-t-md bg-surface-hover outline-none focus-visible:ring-2 focus-visible:ring-accent ${size === 'lg' ? 'h-64' : 'h-48'}`}
      >
        <div
          className={cn(
            'stat-grow-y absolute bottom-0 left-0 right-0 flex flex-col-reverse rounded-t-md overflow-hidden transition group-hover/bar:brightness-110',
            selected && 'brightness-110',
          )}
          style={{ height: `${displayHeight}%`, '--stagger': Math.min(stagger, 12) } as CSSProperties}
        >
          {data.groups.map((group) => (
            <div
              key={group.key}
              className="w-full transition-all duration-500 ease-out motion-reduce:transition-none"
              style={{
                height: `${data.total > 0 ? (group.plays / data.total) * 100 : 0}%`,
                ...(group.gradient
                  ? { background: `linear-gradient(to top, hsl(var(--accent) / 0.45), ${group.color})` }
                  : { backgroundColor: group.color }),
              }}
              title={`${group.key}: ${formatNumber(group.plays)}`}
            />
          ))}
        </div>
        <div
          className={cn(
            'absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-md bg-fg-primary px-2 py-1 text-xs text-bg-primary whitespace-nowrap z-10',
            selected ? 'block' : 'hidden group-hover/bar:block group-focus-visible/bar:block',
          )}
        >
          <div className="font-medium">{formatMonthLabel(data.month)}</div>
          <div className="font-mono tabular-nums">{formatNumber(data.total)} plays</div>
          {data.groups.length > 1 && (
            <div className="mt-1 space-y-0.5">
              {data.groups.map((group) => (
                <div key={group.key} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />
                  <span>{group.key}: {formatNumber(group.plays)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <span
        className={cn(
          'truncate text-center font-mono tabular-nums transition',
          size === 'lg' ? 'text-xs' : 'text-[10px]',
          selected ? 'text-accent' : 'text-fg-secondary group-hover/bar:text-fg-primary',
        )}
      >
        {formatShortMonth(data.month)}
      </span>
    </div>
  );
}

function Legend({ groups }: { groups: { key: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {groups.map((group) => (
        <div key={group.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} />
          <span className="text-xs text-fg-secondary">{group.key}</span>
        </div>
      ))}
    </div>
  );
}

function GroupBySelect({
  value,
  onChange,
}: {
  value: MonthlyPlaysGroupBy | 'total';
  onChange: (value: MonthlyPlaysGroupBy | 'total') => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MonthlyPlaysGroupBy | 'total')}
      className="h-11 rounded-lg border border-rule bg-surface px-3 text-xs text-fg-primary outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
      aria-label="Group by"
    >
      {GROUP_BY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ChartBody({
  data,
  groupBy,
  size,
  showLabels,
}: {
  data: ChartDataItem[];
  groupBy: MonthlyPlaysGroupBy | 'total';
  size: 'sm' | 'lg';
  showLabels?: boolean;
}) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const legendGroups = useMemo(() => {
    if (groupBy === 'total') return [];
    const keys = Array.from(new Set(data.flatMap((d) => d.groups.map((g) => g.key))));
    return keys.map((key, index) => ({ key, color: getGroupColor(index) }));
  }, [data, groupBy]);

  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.total));
  const chartSummary = `Listening activity by month: ${data
    .map((d) => `${formatMonthLabel(d.month)} ${d.total} plays`)
    .join(', ')}`;

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2" role="group" aria-label={chartSummary}>
        {data.map((item, index) => (
          <BarStack
            key={item.month}
            data={item}
            max={max}
            size={size}
            showLabels={showLabels}
            stagger={index}
            selected={selectedMonth === item.month}
            onSelect={() => setSelectedMonth((prev) => (prev === item.month ? null : item.month))}
          />
        ))}
      </div>
      {legendGroups.length > 0 && <Legend groups={legendGroups} />}
    </div>
  );
}

export interface MonthlyActivityChartProps {
  monthlyPlays: StatisticsMonthlyPlaysItem[];
  mode: StatisticsMode;
  userId: string | undefined;
  range: StatisticsTimeRange;
}

export function MonthlyActivityChart({ monthlyPlays, mode, userId, range }: MonthlyActivityChartProps) {
  const [groupBy, setGroupBy] = useState<MonthlyPlaysGroupBy | 'total'>('total');
  const [modalOpen, setModalOpen] = useState(false);
  const grouped = useMonthlyGroupedPlays(
    mode,
    userId,
    range,
    groupBy === 'total' ? 'artist' : groupBy,
    groupBy !== 'total',
  );

  const chartData: ChartDataItem[] = useMemo(() => {
    if (groupBy === 'total') return buildSimpleData(monthlyPlays);
    if (!grouped.data) return [];
    return buildGroupedData(grouped.data.data);
  }, [groupBy, monthlyPlays, grouped.data]);

  if (monthlyPlays.length === 0 && chartData.length === 0) return null;

  return (
    <>
      <div className="rounded-2xl border border-rule bg-surface p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="mdi-chart-bar" size={20} className="text-accent" />
            <h3 className="font-display text-lg font-bold tracking-tight text-fg-primary">Listening Activity</h3>
          </div>
          <div className="flex items-center gap-2">
            <GroupBySelect value={groupBy} onChange={setGroupBy} />
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-rule text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Expand chart"
            >
              <Icon name="mdi-arrow-expand" size={18} />
            </button>
          </div>
        </div>
        <ChartBody data={chartData} groupBy={groupBy} size="sm" />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Listening Activity"
        className="max-w-5xl"
      >
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-secondary">
              {groupBy === 'total'
                ? 'Total plays per month'
                : `Plays grouped by ${GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label.toLowerCase()}`}
            </p>
            <GroupBySelect value={groupBy} onChange={setGroupBy} />
          </div>
          <ChartBody data={chartData} groupBy={groupBy} size="lg" showLabels />
          {groupBy !== 'total' && chartData.length > 0 && (
            <div className="rounded-xl border border-rule bg-surface p-3">
              <h4 className="mb-2 text-sm font-medium text-fg-primary">Breakdown</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {Array.from(
                  chartData
                    .flatMap((d) => d.groups)
                    .reduce((map, group) => {
                      map.set(group.key, (map.get(group.key) ?? 0) + group.plays);
                      return map;
                    }, new Map<string, number>()),
                )
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, plays], index) => (
                    <div key={key} className="flex items-center gap-2 rounded-lg bg-surface-hover px-3 py-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getGroupColor(index) }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-fg-primary">{key}</p>
                        <p className="text-[10px] text-fg-secondary">{formatNumber(plays)} plays</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
