import { useEffect, useState, cloneElement, type ReactElement } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Table } from '../../../components/ui/Table.js';
import { StatusPill } from './StatusPill.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { Icon } from '../../../components/ui/Icon.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useAdminRefresh } from '../contexts/AdminRefreshContext.js';

interface IngestRun {
  id: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  stats?: Record<string, unknown>;
  error: string | null;
}

interface IngestModalProps {
  open: boolean;
  onClose: () => void;
  onSelectRun?: (id: string) => void;
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString();
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return '-';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatRunStats(stats: Record<string, unknown> | undefined): string {
  if (!stats || typeof stats !== 'object') return '-';
  const entries = Object.entries(stats)
    .filter(([key, value]) => key !== 'path' && typeof value === 'number')
    .map(([key, value]) => `${key}: ${value}`);
  return entries.length > 0 ? entries.join(' · ') : '-';
}

export function IngestModal({ open, onClose, onSelectRun }: IngestModalProps) {
  const { refresh } = useAdminRefresh();
  const { notify } = useNotification();
  const [runs, setRuns] = useState<IngestRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [runToDelete, setRunToDelete] = useState<string | null>(null);

  const loadRuns = () => {
    setRunsLoading(true);
    api<{ runs: IngestRun[] }>('/admin/ingest-runs')
      .then((r) => setRuns(r.runs))
      .catch((err) => setRunsError(err instanceof Error ? err.message : 'Failed to load ingest history'))
      .finally(() => setRunsLoading(false));
  };

  useEffect(() => {
    if (open) {
      loadRuns();
    }
  }, [open]);

  const clearHistory = async () => {
    try {
      await api('/admin/ingest-runs', { method: 'DELETE' });
      setConfirmClearOpen(false);
      refresh();
      notify('Ingest history cleared.', 'success');
      loadRuns();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to clear ingest history', 'error');
    }
  };

  const deleteRun = async (id: string) => {
    try {
      await api(`/admin/ingest-runs/${id}`, { method: 'DELETE' });
      setRunToDelete(null);
      refresh();
      notify('Ingest run deleted.', 'success');
      loadRuns();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete ingest run', 'error');
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Ingest history" className="max-w-6xl">
        <div className="space-y-8">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Recent runs</h4>
              <Button
                variant="danger"
                onClick={() => setConfirmClearOpen(true)}
                disabled={runsLoading || runs.length === 0}
              >
                <Icon name="mdi-delete-sweep" size={16} className="mr-1.5" />
                Clear history
              </Button>
            </div>
            {runsError && <p className="text-sm text-danger" role="alert">{runsError}</p>}
            {runsLoading ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : (
              <Table<IngestRun>
                columns={[
                  { key: 'status', header: 'Status', className: 'w-32', render: (r) => <StatusPill status={r.status} /> },
                  {
                    key: 'started',
                    header: 'Started',
                    className: 'w-48',
                    render: (r) => formatDateTime(r.startedAt),
                  },
                  {
                    key: 'finished',
                    header: 'Finished',
                    className: 'w-48',
                    render: (r) => formatDateTime(r.finishedAt),
                  },
                  {
                    key: 'duration',
                    header: 'Duration',
                    className: 'w-28',
                    render: (r) => formatDuration(r.startedAt, r.finishedAt),
                  },
                  {
                    key: 'summary',
                    header: 'Summary',
                    render: (r) => <span className="text-muted">{formatRunStats(r.stats)}</span>,
                  },
                  {
                    key: 'actions',
                    header: '',
                    className: 'w-16',
                    render: (r) => (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRunToDelete(r.id);
                        }}
                        className="rounded p-1 text-fg-secondary transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                        aria-label="Delete ingest run"
                        title="Delete"
                      >
                        <Icon name="mdi-delete" size={16} />
                      </button>
                    ),
                  },
                ]}
                rows={runs}
                rowKey={(r) => r.id}
                empty="No ingest runs."
                renderRow={(run, element) =>
                  cloneElement(element as ReactElement, {
                    onClick: () => onSelectRun?.(run.id),
                    className: `${(element as ReactElement<{ className?: string }>).props.className ?? ''} cursor-pointer hover:bg-surface-hover`,
                  })
                }
              />
            )}
          </section>

        </div>
      </Modal>

      <ConfirmModal
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Clear ingest history"
        message="This will permanently delete all ingest history entries and their associated job details. This action cannot be undone."
        confirmLabel="Clear history"
        danger
        onConfirm={clearHistory}
      />

      <ConfirmModal
        open={runToDelete !== null}
        onClose={() => setRunToDelete(null)}
        title="Delete ingest run"
        message="Are you sure you want to delete this ingest run and its associated job details?"
        confirmLabel="Delete"
        danger
        onConfirm={() => runToDelete && deleteRun(runToDelete)}
      />
    </>
  );
}
