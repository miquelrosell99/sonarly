import { Link } from 'wouter';
import { Icon } from '../../../components/ui/Icon.js';
import { StatusPill } from './StatusPill.js';

interface IngestStatus {
  type: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  stats?: Record<string, unknown>;
}

interface IngestStatusCardProps {
  ingest: IngestStatus;
}

const statLabels: Record<string, string> = {
  scanned: 'Scanned',
  added: 'Added',
  updated: 'Updated',
  removed: 'Removed',
  moved: 'Moved',
  failed: 'Failed',
  processed: 'Processed',
  imported: 'Imported',
  needsReview: 'Needs review',
  total: 'Total',
  done: 'Done',
  skipped: 'Skipped',
  deleted: 'Deleted',
};

const statRoutes: Record<string, string> = {
  scanned: '/songs',
  added: '/songs',
  updated: '/songs',
  moved: '/songs',
  imported: '/songs',
  processed: '/admin/ingest',
  done: '/admin/ingest',
  total: '/admin/ingest',
  skipped: '/admin/ingest',
  failed: '/admin/ingest',
  needsReview: '/settings/conflicts',
  removed: '/settings/missing',
  deleted: '/settings/missing',
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function getDuration(ingest: IngestStatus): string | null {
  const started = new Date(ingest.startedAt).getTime();
  const finished = ingest.finishedAt ? new Date(ingest.finishedAt).getTime() : Date.now();
  if (Number.isNaN(started) || Number.isNaN(finished)) return null;
  return formatDurationMs(finished - started);
}

function getNumericStats(stats: Record<string, unknown> | undefined): { key: string; value: number }[] {
  if (!stats) return [];
  return Object.entries(stats)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => ({ key, value: value as number }));
}

function StatCard({ statKey, value }: { statKey: string; value: number }) {
  const label = statLabels[statKey] ?? statKey;
  const route = statRoutes[statKey];
  const className =
    'rounded border border-rule bg-bg-primary p-3 text-center transition-colors hover:bg-surface-hover';

  return route ? (
    <Link href={route} className={className}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </Link>
  ) : (
    <div className={className}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export function IngestStatusCard({ ingest }: IngestStatusCardProps) {
  const duration = getDuration(ingest);
  const stats = getNumericStats(ingest.stats);

  return (
    <div className="rounded border border-rule bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Latest ingest</p>
          <h3 className="mt-1 text-base font-semibold">Ingest run</h3>
        </div>
        <StatusPill status={ingest.status} />
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <Icon name="mdi-calendar-clock" size={16} className="text-muted" />
          <span className="text-muted">Started:</span>
          <span>{formatDateTime(ingest.startedAt)}</span>
        </div>
        {ingest.finishedAt ? (
          <div className="flex items-center gap-2">
            <Icon name="mdi-clock-check-outline" size={16} className="text-muted" />
            <span className="text-muted">Finished:</span>
            <span>{formatDateTime(ingest.finishedAt)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Icon name="mdi-timer-sand" size={16} className="text-muted" />
            <span className="text-muted">Running for:</span>
            <span>{duration ?? '-'}</span>
          </div>
        )}
      </div>

      {duration && ingest.finishedAt && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Icon name="mdi-timer-outline" size={16} className="text-muted" />
          <span className="text-muted">Duration:</span>
          <span>{duration}</span>
        </div>
      )}

      {stats.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {stats.map((stat) => (
            <StatCard key={stat.key} statKey={stat.key} value={stat.value} />
          ))}
        </div>
      )}
    </div>
  );
}
