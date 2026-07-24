import { useEffect, useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Link } from 'wouter';
import { AdminShell } from '../components/AdminShell.js';
import { IngestStatusCard } from '../components/IngestStatusCard.js';

interface AdminStatus {
  counts: {
    users: number;
    songs: number;
    albums: number;
    artists: number;
  };
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

export function AdminStatus({ user }: AdminStatusProps) {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        {status?.latestIngest ? (
          <IngestStatusCard ingest={status.latestIngest} />
        ) : status ? (
          <div className="rounded border border-rule bg-surface p-4 text-sm text-muted">
            No ingest jobs yet. Go to the{' '}
            <Link href="/admin/ingest" className="text-fg-primary underline hover:text-fg-primary/80">Ingest</Link>{' '}
            tab to trigger one.
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
