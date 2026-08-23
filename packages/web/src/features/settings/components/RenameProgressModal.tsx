import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { ProgressBar } from '../../../components/ui/ProgressBar.js';
import { Button } from '../../../components/ui/Button.js';
import { Modal } from '../../../components/ui/Modal.js';

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
    failedPaths?: string[];
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
  const onCloseRef = useRef(onClose);
  const onCompleteRef = useRef(onComplete);

  onCloseRef.current = onClose;
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let intervalId: ReturnType<typeof setInterval>;

    const finishPolling = () => {
      clearInterval(intervalId);
    };

    const fetchStatus = async () => {
      try {
        const data = await api<{ job: OrganizeStatus }>(`/organize/status/${jobId}`);
        if (cancelled) return;
        setStatus(data.job);
        setError(null);

        if (data.job.status === 'completed' || data.job.status === 'failed') {
          finishPolling();
        }

        if (data.job.status === 'completed') {
          const stats = data.job.stats ?? {};
          if ((stats.failed ?? 0) === 0) {
            timeoutId = setTimeout(() => {
              onCompleteRef.current({
                moved: stats.moved ?? 0,
                skipped: stats.skipped ?? 0,
                failed: stats.failed ?? 0,
              });
              onCloseRef.current();
            }, CLOSE_DELAY_MS);
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch progress');
        finishPolling();
      }
    };

    fetchStatus();
    intervalId = setInterval(fetchStatus, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [jobId]);

  const total = status?.stats?.total ?? 0;
  const done = status?.stats?.done ?? 0;
  const failed = status?.stats?.failed ?? 0;
  const failedPaths = status?.stats?.failedPaths ?? [];
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const isRunning = !status || (status.status !== 'completed' && status.status !== 'failed');
  const showFailures = status?.status === 'completed' && failed > 0;
  const isFailed = status?.status === 'failed';

  return (
    <Modal open onClose={onClose} title="Renaming library…" className="max-w-md">
      {error ? (
        <div className="space-y-4">
          <p className="text-sm text-danger" role="alert">{error}</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ProgressBar
            value={isRunning && total === 0 ? 0 : percent}
            aria-label="Rename progress"
          />
          <p className="text-sm text-fg-primary" aria-live="polite">
            {status?.status === 'completed' && total === 0
              ? 'Nothing to rename'
              : total === 0
                ? 'Scanning…'
                : `${done} of ${total} files renamed (${percent}%)`}
          </p>
          {status?.stats?.currentPath && (
            <p className="break-all text-xs text-muted" title={status.stats.currentPath}>
              {status.stats.currentPath}
            </p>
          )}
          {isFailed && (
            <p className="text-sm text-danger">
              {status.stats?.error || 'Rename failed'}
            </p>
          )}
          {showFailures && (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
              <p className="text-sm font-medium text-danger">
                {failed} file{failed === 1 ? '' : 's'} failed
              </p>
              <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-muted">
                {failedPaths.map((path) => (
                  <li key={path} className="break-all py-0.5" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(showFailures || isFailed) && (
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
