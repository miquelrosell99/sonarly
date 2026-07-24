import { useEffect, useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface AdminStatus {
  counts: {
    users: number;
    songs: number;
    albums: number;
    artists: number;
  };
  latestScan: {
    type: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    stats?: Record<string, unknown>;
  } | null;
}

interface IngestJob {
  id: string;
  source_path: string;
  status: string;
  error: string | null;
  created_at: string;
}

interface AdminProps {
  user: User;
}

export function Admin({ user }: AdminProps) {
  const { notify } = useNotification();
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [form, setForm] = useState({ username: '', password: '', isAdmin: false });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const loadJobs = () => {
    setJobsLoading(true);
    api<{ jobs: IngestJob[] }>('/ingest')
      .then((r) => setJobs(r.jobs))
      .catch((err) => setJobsError(err instanceof Error ? err.message : 'Failed to load ingest history'))
      .finally(() => setJobsLoading(false));
  };

  const triggerIngest = async () => {
    setTriggering(true);
    setJobsError(null);
    try {
      await api('/ingest/trigger', { method: 'POST' });
      loadJobs();
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Failed to trigger ingest');
    } finally {
      setTriggering(false);
    }
  };

  const load = async () => {
    try {
      const [{ users: list }, statusData] = await Promise.all([
        api<{ users: User[] }>('/admin/users'),
        api<AdminStatus>('/admin/status'),
      ]);
      setUsers(list);
      setStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    }
  };

  useEffect(() => {
    if (!user.isAdmin) return;
    load();
    loadJobs();
  }, [user.isAdmin]);

  const updateForm = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const create = async () => {
    if (!form.username.trim() || !form.password) return;
    setCreating(true);
    setError(null);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          isAdmin: form.isAdmin,
        }),
      });
      setForm({ username: '', password: '', isAdmin: false });
      notify('User created.', 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  if (!user.isAdmin) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold">Admin panel</h2>
        <p className="mt-2 text-sm text-muted">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      <h2 className="text-lg font-semibold">Admin panel</h2>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <section className="space-y-4">
        <h3 className="text-base font-medium">Server status</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded border border-rule p-4">
            <p className="text-xs text-muted">Users</p>
            <p className="text-2xl font-semibold">{status?.counts.users ?? '-'}</p>
          </div>
          <div className="rounded border border-rule p-4">
            <p className="text-xs text-muted">Songs</p>
            <p className="text-2xl font-semibold">{status?.counts.songs ?? '-'}</p>
          </div>
          <div className="rounded border border-rule p-4">
            <p className="text-xs text-muted">Albums</p>
            <p className="text-2xl font-semibold">{status?.counts.albums ?? '-'}</p>
          </div>
          <div className="rounded border border-rule p-4">
            <p className="text-xs text-muted">Artists</p>
            <p className="text-2xl font-semibold">{status?.counts.artists ?? '-'}</p>
          </div>
        </div>
        {status?.latestScan && (
          <div className="rounded border border-rule p-4">
            <p className="text-xs text-muted">Latest scan</p>
            <p className="text-sm">
              {status.latestScan.type} — {status.latestScan.status}
              {status.latestScan.finishedAt && ` • ${new Date(status.latestScan.finishedAt).toLocaleString()}`}
            </p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Ingest history</h3>
          <Button onClick={triggerIngest} disabled={triggering}>
            Trigger ingest
          </Button>
        </div>
        {jobsError && <p className="text-sm text-danger" role="alert">{jobsError}</p>}
        {jobsLoading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : (
          <Table<IngestJob>
            columns={[
              { key: 'path', header: 'Path', render: (j) => j.source_path },
              { key: 'status', header: 'Status', className: 'w-32', render: (j) => j.status },
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
            ]}
            rows={jobs}
            rowKey={(j) => j.id}
            empty="No ingest jobs."
          />
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-medium">Users</h3>
        <div className="space-y-3 border border-rule p-4">
          <Input
            placeholder="Username"
            value={form.username}
            onChange={(e) => updateForm({ username: e.target.value })}
          />
          <Input
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(e) => updateForm({ password: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isAdmin}
              onChange={(e) => updateForm({ isAdmin: e.target.checked })}
              className="rounded border-rule"
            />
            Admin
          </label>
          <Button onClick={create} disabled={creating || !form.username.trim() || !form.password}>
            Create User
          </Button>
        </div>

        <div className="border border-rule">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Username</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Name</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Admin</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-rule">
                  <td className="px-4 py-2">{u.username}</td>
                  <td className="px-4 py-2">{[u.name, u.surname].filter(Boolean).join(' ') || '-'}</td>
                  <td className="px-4 py-2">{u.isAdmin ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
