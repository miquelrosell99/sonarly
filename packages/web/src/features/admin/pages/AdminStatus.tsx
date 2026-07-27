import { useEffect, useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { AdminShell } from '../components/AdminShell.js';
import { IngestStatusCard } from '../components/IngestStatusCard.js';
import { StatusWidget } from '../components/StatusWidget.js';
import { ConflictsModal } from '../components/ConflictsModal.js';
import { MissingModal } from '../components/MissingModal.js';
import { IngestModal } from '../components/IngestModal.js';

interface AdminStatus {
  counts: {
    users: number;
    songs: number;
    albums: number;
    artists: number;
  };
  conflictsCount: number;
  missingCounts: {
    songs: number;
    albums: number;
    artists: number;
  };
  ingestJobsCount: number;
  latestIngest: {
    type: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    stats?: Record<string, unknown>;
  } | null;
}

interface AdminStatusProps {
  user: User;
}

type ActiveModal = 'conflicts' | 'missing' | 'ingest' | null;

export function AdminStatus({ user }: AdminStatusProps) {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  useEffect(() => {
    if (!user.isAdmin) return;
    api<AdminStatus>('/admin/status')
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load server status'));
  }, [user.isAdmin]);

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatusWidget
            label="Conflicting files"
            count={status?.conflictsCount ?? 0}
            icon="mdi-file-alert"
            onClick={() => setActiveModal('conflicts')}
          />
          <StatusWidget
            label="Missing items"
            count={
              status
                ? status.missingCounts.songs + status.missingCounts.albums + status.missingCounts.artists
                : 0
            }
            icon="mdi-file-hidden"
            onClick={() => setActiveModal('missing')}
          />
          <StatusWidget
            label="Ingest jobs"
            count={status?.ingestJobsCount ?? 0}
            icon="mdi-folder-download"
            status={status?.latestIngest?.status}
            onClick={() => setActiveModal('ingest')}
          />
        </div>

        {status?.latestIngest ? (
          <IngestStatusCard
            ingest={status.latestIngest}
            onOpenIngest={() => setActiveModal('ingest')}
            onOpenConflicts={() => setActiveModal('conflicts')}
            onOpenMissing={() => setActiveModal('missing')}
          />
        ) : status ? (
          <div className="rounded border border-rule bg-surface p-4 text-sm text-muted">
            No ingest jobs yet. Go to the{' '}
            <button
              type="button"
              onClick={() => setActiveModal('ingest')}
              className="text-fg-primary underline hover:text-fg-primary/80"
            >
              Ingest
            </button>{' '}
            widget or use the Media page to trigger one.
          </div>
        ) : null}
      </div>

      <ConflictsModal open={activeModal === 'conflicts'} onClose={() => setActiveModal(null)} />
      <MissingModal open={activeModal === 'missing'} onClose={() => setActiveModal(null)} />
      <IngestModal open={activeModal === 'ingest'} onClose={() => setActiveModal(null)} />
    </AdminShell>
  );
}
