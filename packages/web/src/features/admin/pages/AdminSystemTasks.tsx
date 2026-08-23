import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { PageState } from '../../../components/PageState.js';
import { Table } from '../../../components/ui/Table.js';
import type { TableColumn } from '../../../components/ui/Table.js';
import { Icon } from '../../../components/ui/Icon.js';
import { StatusPill } from '../components/StatusPill.js';
import { AdminShell } from '../components/AdminShell.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useAdminRefresh } from '../contexts/AdminRefreshContext.js';

type SystemTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface SystemTask {
  id: string;
  name: string;
  description: string;
  lastRunAt: string | null;
  status: SystemTaskStatus | null;
  intervalMinutes: number | null;
}

interface SystemTaskHistoryItem {
  id: string;
  task: string;
  type: string;
  status: SystemTaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  stats?: Record<string, unknown>;
}

function formatLastRun(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString();
}

function formatInterval(minutes: number | null): string {
  if (minutes === null) return 'Manual';
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return '1 hour';
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
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

interface ScanFailure {
  path: string;
  error: string;
}

function formatStats(stats: Record<string, unknown> | undefined): ReactNode {
  if (!stats || typeof stats !== 'object') return '-';

  const failures = Array.isArray(stats.failures)
    ? (stats.failures as ScanFailure[]).filter((f) => f && typeof f.path === 'string' && typeof f.error === 'string')
    : [];

  if (failures.length > 0) {
    const summary = failures.length === 1
      ? failures[0].error
      : `${failures.length} failures`;
    const tooltip = failures.map((f) => `${f.path}\n${f.error}`).join('\n\n');
    return (
      <span title={tooltip} className="cursor-help text-danger">
        {summary}
      </span>
    );
  }

  const entries = Object.entries(stats)
    .filter(([key, value]) => key !== 'failures' && (typeof value === 'number' || typeof value === 'string'))
    .map(([key, value]) => `${key}: ${value}`);
  return entries.length > 0 ? entries.join(' · ') : '-';
}

interface AdminSystemTasksProps {
  user: User;
}

export function AdminSystemTasks({ user }: AdminSystemTasksProps) {
  const { notify } = useNotification();
  const { refreshKey, refresh } = useAdminRefresh();
  const [tasks, setTasks] = useState<SystemTask[]>([]);
  const [history, setHistory] = useState<SystemTaskHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const loadTasks = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const data = await api<{ tasks: SystemTask[] }>('/admin/system-tasks');
      setTasks(data.tasks);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load system tasks', 'error');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  const loadHistory = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setHistoryLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), limit: String(limit) });
      const data = await api<{
        history: SystemTaskHistoryItem[];
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      }>(`/admin/system-tasks/history?${query.toString()}`);
      setHistory(data.history);
      setTotalPages(data.totalPages);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load task history', 'error');
    } finally {
      if (!options?.silent) setHistoryLoading(false);
    }
  };

  const load = async (options?: { silent?: boolean }) => {
    await Promise.all([loadTasks(options), loadHistory(options)]);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadHistory();
  }, [page, limit]);

  useEffect(() => {
    load({ silent: true });
  }, [refreshKey]);

  useEffect(() => {
    const interval = setInterval(() => load({ silent: true }), 3000);
    return () => clearInterval(interval);
  }, [page, limit]);

  const runTask = async (id: string) => {
    setRunning((prev) => ({ ...prev, [id]: true }));
    try {
      await api('/admin/system-tasks/' + id + '/run', { method: 'POST' });
      refresh();
      notify('Task queued.', 'success');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to run task', 'error');
    } finally {
      setRunning((prev) => ({ ...prev, [id]: false }));
    }
  };

  const historyColumns: TableColumn<SystemTaskHistoryItem>[] = [
    { key: 'task', header: 'Task', render: (row) => row.task },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusPill status={row.status} />,
    },
    { key: 'started', header: 'Started', render: (row) => <span className="font-mono">{formatLastRun(row.startedAt)}</span> },
    { key: 'finished', header: 'Finished', render: (row) => <span className="font-mono">{formatLastRun(row.finishedAt)}</span> },
    { key: 'duration', header: 'Duration', render: (row) => <span className="font-mono">{formatDuration(row.startedAt, row.finishedAt)}</span> },
    { key: 'details', header: 'Details', render: (row) => <span className="text-muted">{formatStats(row.stats)}</span> },
  ];

  return (
    <AdminShell user={user}>
      <div className="w-full space-y-6">
        <div className="space-y-4">
          <h3 className="text-base font-medium">System tasks</h3>
          <p className="text-sm text-muted">
            Background maintenance tasks run automatically on a schedule. You can also queue them manually.
          </p>

          <PageState loading={loading} isEmpty={tasks.length === 0} emptyMessage="No system tasks configured.">
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-col gap-3 rounded-md border border-rule bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{task.name}</h4>
                      {task.status && <StatusPill status={task.status} />}
                    </div>
                    <p className="mt-1 text-sm text-muted">{task.description}</p>
                    <p className="mt-1 text-xs text-muted">
                      Interval: {formatInterval(task.intervalMinutes)} · Last run: {formatLastRun(task.lastRunAt)}
                    </p>
                  </div>
                  <Button
                    onClick={() => runTask(task.id)}
                    disabled={running[task.id] || task.status === 'running'}
                    variant="ghost"
                  >
                    {running[task.id] ? 'Queueing...' : task.status === 'running' ? 'Running' : 'Run now'}
                  </Button>
                </div>
              ))}
            </div>
          </PageState>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-md border border-rule bg-surface p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div>
              <h3 className="text-base font-medium">History</h3>
              <p className="text-sm text-muted">Recent system task runs.</p>
            </div>
            <Icon
              name={historyOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'}
              size={24}
              className="text-fg-secondary"
            />
          </button>

          {historyOpen && (
            <div className="space-y-4">
              <PageState
                loading={historyLoading}
                isEmpty={history.length === 0}
                emptyMessage="No task history yet."
              >
                <div className="rounded-md border border-rule">
                  <Table
                    columns={historyColumns}
                    rows={history}
                    rowKey={(row) => row.id}
                    empty={<p className="text-sm text-muted">No task history yet.</p>}
                  />
                </div>
              </PageState>

              {!historyLoading && totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <Button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    variant="ghost"
                    aria-label="Previous page"
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    variant="ghost"
                    aria-label="Next page"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
