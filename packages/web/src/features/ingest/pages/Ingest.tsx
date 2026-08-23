import { useEffect, useMemo, useState } from 'react';
import type { Library } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';
import { PageState } from '../../../components/PageState.js';
import { ProgressBar } from '../../../components/ui/ProgressBar.js';
import { StatusPill } from '../../admin/components/StatusPill.js';

const ACTIVE_STATUSES = new Set(['pending', 'running']);
const POLL_INTERVAL_MS = 2000;

interface IngestJob {
  id: string;
  source_path: string;
  status: string;
  error: string | null;
  duplicate: number | null;
  duplicate_strategy: string | null;
  created_at: string;
}

export function Ingest() {
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultLibrary = useMemo(
    () => libraries.find((l) => l.isDefault) ?? libraries[0],
    [libraries],
  );

  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ jobs: IngestJob[] }>('/ingest'),
      api<{ libraries: Library[] }>('/libraries'),
    ])
      .then(([jobsRes, libsRes]) => {
        setJobs(jobsRes.jobs);
        setLibraries(libsRes.libraries);
        const def = libsRes.libraries.find((l) => l.isDefault) ?? libsRes.libraries[0];
        setSelectedLibraryId((prev) => (prev ? prev : def?.id ?? ''));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ingest queue'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const hasActiveJobs = jobs.some((j) => ACTIVE_STATUSES.has(j.status));

  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => {
      api<{ jobs: IngestJob[] }>('/ingest')
        .then((r) => setJobs(r.jobs))
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasActiveJobs]);

  const doneCount = jobs.filter((j) => !ACTIVE_STATUSES.has(j.status)).length;
  const progress = jobs.length > 0 ? Math.round((doneCount / jobs.length) * 100) : 0;

  const trigger = async () => {
    const libraryId = selectedLibraryId || defaultLibrary?.id;
    if (!libraryId) {
      setError('No library selected.');
      return;
    }
    setTriggering(true);
    setError(null);
    try {
      await api('/ingest/trigger', {
        method: 'POST',
        body: JSON.stringify({ libraryId }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger ingest');
    } finally {
      setTriggering(false);
    }
  };

  const columns: TableColumn<IngestJob>[] = [
    { key: 'path', header: 'Path', render: (j) => j.source_path },
    {
      key: 'duplicate',
      header: '',
      className: 'w-24',
      render: (j) =>
        j.duplicate ? (
          <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
            Existing
          </span>
        ) : null,
    },
    { key: 'status', header: 'Status', className: 'w-32', render: (j) => <StatusPill status={j.status} /> },
    {
      key: 'error',
      header: 'Error',
      render: (j) => <span className={j.error ? 'text-danger' : ''}>{j.error || '-'}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      className: 'w-40',
      render: (j) => new Date(j.created_at).toLocaleString(),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Ingest Queue</h2>
        <div className="flex items-center gap-3">
          <select
            value={selectedLibraryId}
            onChange={(e) => setSelectedLibraryId(e.target.value)}
            disabled={triggering || libraries.length === 0}
            className="input"
            aria-label="Library"
          >
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name} {library.isDefault ? '(default)' : ''}
              </option>
            ))}
          </select>
          <Button onClick={trigger} disabled={triggering || libraries.length === 0}>
            Trigger Ingest
          </Button>
        </div>
      </div>
      {error && <p className="mb-4 text-sm text-danger" role="alert">{error}</p>}
      {hasActiveJobs && (
        <div className="mb-4 space-y-2">
          <ProgressBar value={progress} aria-label="Ingest progress" />
          <p className="text-sm text-muted" aria-live="polite">
            Processing ingest queue: {doneCount} of {jobs.length} files done
          </p>
        </div>
      )}
      <PageState loading={loading}>
        <Table columns={columns} rows={jobs} rowKey={(j) => j.id} empty="No ingest jobs." />
      </PageState>
    </div>
  );
}
