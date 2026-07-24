import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { ProgressBar } from '../../../components/ui/ProgressBar.js';
import { Button } from '../../../components/ui/Button.js';

interface OrganizeStatus {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  stats?: {
    total?: number;
    done?: number;
    moved?: number;
    skipped?: number;
    failed?: number;
    currentPath?: string;
    error?: string;
  };
}

interface RenameProgressModalProps {
  jobId: string;
  onClose: () => void;
  onComplete: (summary: { moved: number; skipped: number; failed: number }) => void;
}

const POLL_INTERVAL_MS = 500;
const CLOSE_DELAY_MS = 800;

export function RenameProgressModal({ jobId, onClose, onComplete }: RenameProgressModalProps) {
  const [status, setStatus] = useState<OrganizeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let intervalId: ReturnType<typeof setInterval>;

    const fetchStatus = async () => {
      try {
        const data = await api<{ job: OrganizeStatus }>(`/organize/status/${jobId}`);
        if (cancelled) return;
        setStatus(data.job);
        setError(null);

        if (data.job.status === 'completed' || data.job.status === 'failed') {
          clearInterval(intervalId);
        }

        if (data.job.status === 'completed') {
          const stats = data.job.stats ?? {};
          if ((stats.failed ?? 0) === 0) {
            timeoutId = setTimeout(() => {
              onComplete({
                moved: stats.moved ?? 0,
                skipped: stats.skipped ?? 0,
                failed: stats.failed ?? 0,
              });
              onClose();
            }, CLOSE_DELAY_MS);
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch progress');
      }
    };

    fetchStatus();
    intervalId = setInterval(fetchStatus, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [jobId, onClose, onComplete]);

  const total = status?.stats?.total ?? 0;
  const done = status?.stats?.done ?? 0;
  const failed = status?.stats?.failed ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const isRunning = !status || (status.status !== 'completed' && status.status !== 'failed');
  const showFailures = status?.status === 'completed' && failed > 0;
  const isFailed = status?.status === 'failed';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-rule bg-surface p-6 shadow-lg">
        <h2 id="rename-modal-title" className="mb-4 text-lg font-semibold">
          Renaming library…
        </h2>

        {error ? (
          <div className="space-y-4">
            <p className="text-sm text-red-500">{error}</p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ProgressBar value={isRunning && total === 0 ? 0 : percent} />
            <p className="text-sm text-fg-primary">
              {total === 0 ? 'Scanning…' : `${done} of ${total} files renamed (${percent}%)`}
            </p>
            {status?.stats?.currentPath && (
              <p className="break-all text-xs text-muted" title={status.stats.currentPath}>
                {status.stats.currentPath}
              </p>
            )}
            {isFailed && (
              <p className="text-sm text-red-500">
                {status.stats?.error || 'Rename failed'}
              </p>
            )}
            {showFailures && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-sm font-medium text-red-500">
                  {failed} file{failed === 1 ? '' : 's'} failed
                </p>
                <p className="text-xs text-muted">Check server logs for details.</p>
              </div>
            )}
            {(showFailures || isFailed) && (
              <div className="flex justify-end">
                <Button onClick={onClose}>Close</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
