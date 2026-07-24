import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Settings } from '../components/Settings.js';
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

export function SettingsSystemTasks() {
  const { notify } = useNotification();
  const [tasks, setTasks] = useState<SystemTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await api<{ tasks: SystemTask[] }>('/settings/system-tasks');
      setTasks(data.tasks);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load system tasks', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runTask = async (id: string) => {
    setRunning((prev) => ({ ...prev, [id]: true }));
    try {
      await api('/settings/system-tasks/' + id + '/run', { method: 'POST' });
      notify('Task queued.', 'success');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to run task', 'error');
    } finally {
      setRunning((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <Settings>
      <div className="max-w-3xl space-y-4">
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
    </Settings>
  );
}
