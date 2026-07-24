import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';

export function Organize() {
  const [pattern, setPattern] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ pattern: string }>('/organize/preview')
      .then((r) => setPattern(r.pattern))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load pattern'))
      .finally(() => setLoading(false));
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api<{ stats: Record<string, unknown> }>('/organize', { method: 'POST' });
      setResult(r.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reorganize failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Organize Library</h2>
      {loading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            Current pattern: <code className="rounded bg-surface px-1 py-0.5">{pattern}</code>
          </p>
          <Button onClick={run} disabled={running}>
            Reorganize existing library
          </Button>
        </>
      )}
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {result && (
        <pre className="mt-4 rounded border border-rule bg-surface p-3 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
