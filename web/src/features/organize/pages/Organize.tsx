import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { PageState } from '../../../components/PageState.js';
import { RenameProgressModal } from '../../settings/index.js';
import { StatCard } from '../../admin/components/StatCard.js';

interface OrganizeSummary {
  moved: number;
  skipped: number;
  failed: number;
}

export function Organize() {
  const [pattern, setPattern] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<OrganizeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ pattern: string }>('/organize/preview')
      .then((r) => setPattern(r.pattern))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load pattern'))
      .finally(() => setLoading(false));
  }, []);

  const run = async () => {
    setStarting(true);
    setError(null);
    setSummary(null);
    try {
      const data = await api<{ jobId: string }>('/organize/job', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setJobId(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reorganize failed');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Organize Library</h2>
      <PageState loading={loading}>
        <p className="mb-4 text-sm text-muted">
          Current pattern: <code className="rounded bg-surface px-1 py-0.5">{pattern}</code>
        </p>
        <Button onClick={run} disabled={starting || jobId !== null}>
          {starting ? 'Starting…' : jobId !== null ? 'Reorganizing…' : 'Reorganize existing library'}
        </Button>
      </PageState>
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard icon="mdi-check-circle-outline" label="Moved" value={summary.moved} />
          <StatCard icon="mdi-skip-next" label="Skipped" value={summary.skipped} />
          <StatCard icon="mdi-alert-circle-outline" label="Failed" value={summary.failed} />
        </div>
      )}
      {jobId && (
        <RenameProgressModal
          jobId={jobId}
          onClose={() => setJobId(null)}
          onComplete={(s) => setSummary(s)}
        />
      )}
    </div>
  );
}
