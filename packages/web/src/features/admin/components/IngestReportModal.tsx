import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api.js';
import { Modal } from '../../../components/ui/Modal.js';
import { StatusPill } from './StatusPill.js';
import { Icon } from '../../../components/ui/Icon.js';

interface IngestJob {
  id: string;
  sourcePath: string;
  targetPath?: string;
  status: string;
  error: string | null;
  duplicate: boolean;
  duplicateStrategy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface IngestRun {
  id: string;
  type: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  stats?: Record<string, unknown>;
  error: string | null;
  jobs: IngestJob[];
}

type FilterStatus = 'all' | 'failed' | 'needs_review' | 'imported' | 'skipped';

interface IngestReportModalProps {
  runId?: string;
  open: boolean;
  onClose: () => void;
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
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

function getDuration(run: IngestRun): string | null {
  if (!run.startedAt) return null;
  const started = new Date(run.startedAt).getTime();
  const finished = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  if (Number.isNaN(started) || Number.isNaN(finished)) return null;
  return formatDurationMs(finished - started);
}

const filterOptions: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Failed' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'imported', label: 'Imported' },
  { key: 'skipped', label: 'Skipped' },
];

export function IngestReportModal({ runId, open, onClose }: IngestReportModalProps) {
  const [run, setRun] = useState<IngestRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');

  useEffect(() => {
    if (!open) {
      setRun(null);
      setError(null);
      setFilter('all');
      return;
    }

    if (runId) {
      setLoading(true);
      api<IngestRun>(`/admin/ingest-runs/${runId}`)
        .then((r) => setRun(r))
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ingest report'))
        .finally(() => setLoading(false));
    }
  }, [open, runId]);

  const filteredJobs = useMemo(() => {
    if (!run) return [];
    if (filter === 'all') return run.jobs;
    return run.jobs.filter((j) => j.status === filter);
  }, [run, filter]);

  return (
    <Modal open={open} onClose={onClose} title="Ingest report" className="max-w-4xl">
      <div className="space-y-5">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {loading && <p className="text-sm text-muted">Loading...</p>}

        {run && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={run.status} />
              <span className="text-sm text-muted">
                {formatDateTime(run.startedAt)} — {run.finishedAt ? formatDateTime(run.finishedAt) : 'running'}
              </span>
              {run.finishedAt && (
                <span className="text-sm text-muted">({getDuration(run)})</span>
              )}
            </div>

            {run.error && (
              <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
                <div className="flex items-start gap-2">
                  <Icon name="mdi-alert-circle-outline" size={18} className="mt-0.5 shrink-0 text-danger" />
                  <div>
                    <p className="text-sm font-medium text-danger">Run failed</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg-primary">{run.error}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Filter</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {filterOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setFilter(option.key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      filter === option.key
                        ? 'bg-accent text-bg-primary'
                        : 'border border-rule bg-surface text-fg-secondary hover:bg-surface-hover'
                    }`}
                  >
                    {option.label}
                    {option.key !== 'all' && (
                      <span className="ml-1.5 opacity-80">
                        {run.jobs.filter((j) => j.status === option.key).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {filteredJobs.length === 0 ? (
              <p className="text-sm text-muted">
                {filter === 'all' ? 'No individual jobs recorded for this run.' : 'No jobs match the selected filter.'}
              </p>
            ) : (
              <ul className="divide-y divide-rule rounded-lg border border-rule">
                {filteredJobs.map((j) => (
                  <li key={j.id} className="p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="break-all text-sm font-medium">{j.sourcePath}</p>
                        {j.targetPath && (
                          <p className="mt-1 break-all text-xs text-muted">→ {j.targetPath}</p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <StatusPill status={j.status} />
                      </div>
                    </div>
                    {j.error && (
                      <div className="mt-3 rounded border border-danger/20 bg-danger/5 p-3">
                        <p className="text-xs font-medium text-danger">Failure reason</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-fg-primary">{j.error}</p>
                      </div>
                    )}
                    {j.duplicate && (
                      <p className="mt-2 text-xs text-muted">
                        Duplicate — {j.duplicateStrategy ? j.duplicateStrategy.replace(/_/g, ' ') : 'default strategy'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
