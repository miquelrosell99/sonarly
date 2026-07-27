import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Table } from '../../../components/ui/Table.js';
import type { TableColumn } from '../../../components/ui/Table.js';
import { AdminShell } from '../components/AdminShell.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

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

function statusClass(status: SystemTaskStatus): string {
  switch (status) {
    case 'running':
      return 'text-blue-500';
    case 'completed':
      return 'text-green-500';
    case 'failed':
      return 'text-danger';
    case 'pending':
      return 'text-yellow-500';
    default:
      return 'text-muted';
  }
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
  const [tasks, setTasks] = useState<SystemTask[]>([]);
  const [history, setHistory] = useState<SystemTaskHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await api<{ tasks: SystemTask[] }>('/admin/system-tasks');
      setTasks(data.tasks);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load system tasks', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
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
      setHistoryLoading(false);
    }
  };

  const load = async () => {
    await Promise.all([loadTasks(), loadHistory()]);
  };

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    loadHistory();
  }, [page, limit]);

  const runTask = async (id: string) => {
    setRunning((prev) => ({ ...prev, [id]: true }));
    try {
      await api('/admin/system-tasks/' + id + '/run', { method: 'POST' });
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
      render: (row) => (
        <span className={`text-xs font-medium uppercase tracking-wide ${statusClass(row.status)}`}>
          {row.status}
        </span>
      ),
    },
    { key: 'started', header: 'Started', render: (row) => formatLastRun(row.startedAt) },
    { key: 'finished', header: 'Finished', render: (row) => formatLastRun(row.finishedAt) },
    { key: 'duration', header: 'Duration', render: (row) => formatDuration(row.startedAt, row.finishedAt) },
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

          {loading && <p className="text-sm text-muted">Loading...</p>}

          {!loading && tasks.length === 0 && (
            <p className="text-sm text-muted">No system tasks configured.</p>
          )}

          {!loading && tasks.length > 0 && (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-col gap-3 rounded-md border border-rule bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{task.name}</h4>
                      {task.status && (
                        <span className={`text-xs font-medium uppercase tracking-wide ${statusClass(task.status)}`}>
                          {task.status}
                        </span>
                      )}
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
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-base font-medium">History</h3>
          <p className="text-sm text-muted">Recent system task runs.</p>

          {historyLoading && <p className="text-sm text-muted">Loading...</p>}

          {!historyLoading && history.length === 0 && (
            <p className="text-sm text-muted">No task history yet.</p>
          )}

          {!historyLoading && history.length > 0 && (
            <div className="rounded-md border border-rule">
              <Table
                columns={historyColumns}
                rows={history}
                rowKey={(row) => row.id}
                empty={<p className="text-sm text-muted">No task history yet.</p>}
              />
            </div>
          )}

          {!historyLoading && totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                variant="ghost"
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
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
