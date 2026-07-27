import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Table } from '../../../components/ui/Table.js';
import { StatusPill } from './StatusPill.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface IngestJob {
  id: string;
  source_path: string;
  status: string;
  error: string | null;
  created_at: string;
}

const RETENTION_OPTIONS = [30, 60, 90];

interface IngestModalProps {
  open: boolean;
  onClose: () => void;
}

export function IngestModal({ open, onClose }: IngestModalProps) {
  const { notify } = useNotification();
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [initialRetentionDays, setInitialRetentionDays] = useState<number>(30);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isDirty = retentionDays !== initialRetentionDays;

  const loadJobs = () => {
    setJobsLoading(true);
    api<{ jobs: IngestJob[] }>('/ingest')
      .then((r) => setJobs(r.jobs))
      .catch((err) => setJobsError(err instanceof Error ? err.message : 'Failed to load ingest history'))
      .finally(() => setJobsLoading(false));
  };

  const loadSettings = () => {
    setSettingsLoading(true);
    api<{ reviewRetentionDays: number }>('/settings')
      .then((r) => {
        setRetentionDays(r.reviewRetentionDays);
        setInitialRetentionDays(r.reviewRetentionDays);
      })
      .catch((err) => notify(err instanceof Error ? err.message : 'Failed to load settings', 'error'))
      .finally(() => setSettingsLoading(false));
  };

  useEffect(() => {
    if (open) {
      loadJobs();
      loadSettings();
    }
  }, [open]);

  const saveRetention = async () => {
    setSaving(true);
    try {
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({ reviewRetentionDays: retentionDays }),
      });
      setInitialRetentionDays(retentionDays);
      notify('Settings saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Ingest history" className="max-w-5xl">
      <div className="space-y-8">
        <section className="space-y-4">
          {jobsError && <p className="text-sm text-danger" role="alert">{jobsError}</p>}
          {jobsLoading ? (
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
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Ingest cleanup</h4>
            {isDirty && !settingsLoading && (
              <Button onClick={saveRetention} disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
            )}
          </div>
          {settingsLoading ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : (
            <div>
              <label htmlFor="retention" className="mb-1 block text-sm font-medium text-fg-primary">
                Review folder cleanup
              </label>
              <p className="mb-2 text-sm text-muted">
                Files moved to the ingest review folder are automatically deleted after this many days.
              </p>
              <select
                id="retention"
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="input"
                disabled={saving}
              >
                {RETENTION_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
