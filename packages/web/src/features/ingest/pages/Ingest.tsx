import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';

interface IngestJob {
  id: string;
  source_path: string;
  status: string;
  error: string | null;
  created_at: string;
}

export function Ingest() {
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api<{ jobs: IngestJob[] }>('/ingest')
      .then((r) => setJobs(r.jobs))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ingest queue'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const trigger = async () => {
    setTriggering(true);
    setError(null);
    try {
      await api('/ingest/trigger', { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger ingest');
      setTriggering(false);
    }
  };

  const columns: TableColumn<IngestJob>[] = [
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
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ingest Queue</h2>
        <Button onClick={trigger} disabled={triggering}>
          Trigger Ingest
        </Button>
      </div>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <Table columns={columns} rows={jobs} rowKey={(j) => j.id} empty="No ingest jobs." />
      )}
    </div>
  );
}
