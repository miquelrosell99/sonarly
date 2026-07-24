import { useEffect, useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Table } from '../../../components/ui/Table.js';
import { AdminShell } from '../components/AdminShell.js';
import { StatusPill } from '../components/StatusPill.js';

interface IngestJob {
  id: string;
  source_path: string;
  status: string;
  error: string | null;
  created_at: string;
}

interface AdminIngestProps {
  user: User;
}

export function AdminIngest({ user }: AdminIngestProps) {
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = () => {
    setLoading(true);
    api<{ jobs: IngestJob[] }>('/ingest')
      .then((r) => setJobs(r.jobs))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ingest history'))
      .finally(() => setLoading(false));
  };

  const triggerIngest = async () => {
    setTriggering(true);
    setError(null);
    try {
      await api('/ingest/trigger', { method: 'POST' });
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger ingest');
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => {
    if (!user.isAdmin) return;
    loadJobs();
  }, [user.isAdmin]);

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Ingest history</h3>
          <Button onClick={triggerIngest} disabled={triggering}>
            Trigger ingest
          </Button>
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : (
          <Table<IngestJob>
            columns={[
              { key: 'path', header: 'Path', render: (j) => j.source_path },
              { key: 'status', header: 'Status', className: 'w-40', render: (j) => <StatusPill status={j.status} /> },
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
      </div>
    </AdminShell>
  );
}
