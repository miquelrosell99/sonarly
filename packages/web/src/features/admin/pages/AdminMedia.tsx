import { useEffect, useState } from 'react';
import type { User, DuplicateStrategy } from '@sonarly/shared';
import { DUPLICATE_STRATEGY_LABELS } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { PageState } from '../../../components/PageState.js';
import { AdminShell } from '../components/AdminShell.js';
import { StatCard } from '../components/StatCard.js';
import { RenameProgressModal } from '../../settings/index.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useAdminRefresh } from '../contexts/AdminRefreshContext.js';

const RETENTION_OPTIONS = [30, 60, 90];

interface AdminStatusCounts {
  counts: {
    users: number;
    songs: number;
    albums: number;
    artists: number;
  };
}

interface AdminMediaProps {
  user: User;
}

export function AdminMedia({ user }: AdminMediaProps) {
  const { refresh } = useAdminRefresh();
  const { notify } = useNotification();
  const [counts, setCounts] = useState<AdminStatusCounts['counts'] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [triggeringIngest, setTriggeringIngest] = useState(false);
  const [refetchingArtists, setRefetchingArtists] = useState(false);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy | ''>('');
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [initialRetentionDays, setInitialRetentionDays] = useState<number>(30);
  const [savingRetention, setSavingRetention] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<AdminStatusCounts>('/admin/status'),
      api<{ duplicateStrategy: DuplicateStrategy; reviewRetentionDays: number }>('/settings/media'),
    ])
      .then(([statusData, settingsData]) => {
        setCounts(statusData.counts);
        setDuplicateStrategy(settingsData.duplicateStrategy);
        setRetentionDays(settingsData.reviewRetentionDays);
        setInitialRetentionDays(settingsData.reviewRetentionDays);
      })
      .catch((err) => notify(err instanceof Error ? err.message : 'Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, [notify]);

  const forceRename = async () => {
    try {
      const data = await api<{ jobId: string }>('/organize/job', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setJobId(data.jobId);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to start rename', 'error');
    }
  };

  const triggerIngest = async () => {
    setTriggeringIngest(true);
    try {
      await api('/ingest/trigger', { method: 'POST' });
      refresh();
      notify('Ingest triggered.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to trigger ingest', 'error');
    } finally {
      setTriggeringIngest(false);
    }
  };

  const refetchArtists = async () => {
    setRefetchingArtists(true);
    try {
      await api('/admin/artists/refetch', { method: 'POST' });
      refresh();
      notify('Artist image and metadata refetch started.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to refetch artist data', 'error');
    } finally {
      setRefetchingArtists(false);
    }
  };

  const saveDuplicateStrategy = async () => {
    if (!duplicateStrategy) return;
    setSavingStrategy(true);
    try {
      await api('/settings/media', {
        method: 'PATCH',
        body: JSON.stringify({ duplicateStrategy }),
      });
      notify('Default duplicate strategy saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save duplicate strategy', 'error');
    } finally {
      setSavingStrategy(false);
    }
  };

  const saveRetention = async () => {
    setSavingRetention(true);
    try {
      await api('/settings/media', {
        method: 'PATCH',
        body: JSON.stringify({ reviewRetentionDays: retentionDays }),
      });
      setInitialRetentionDays(retentionDays);
      notify('Review folder retention saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save retention settings', 'error');
    } finally {
      setSavingRetention(false);
    }
  };

  if (loading) {
    return (
      <AdminShell user={user}>
        <PageState loading>{null}</PageState>
      </AdminShell>
    );
  }

  return (
    <AdminShell user={user}>
      <div className="w-full space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Media Management</h3>
          <Button onClick={forceRename} disabled={jobId !== null} variant="ghost">
            {jobId !== null ? 'Renaming...' : 'Force rename'}
          </Button>
        </div>

        {counts && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon="mdi-music" label="Songs" value={counts.songs} />
            <StatCard icon="mdi-album" label="Albums" value={counts.albums} />
            <StatCard icon="mdi-account-music" label="Artists" value={counts.artists} />
            <StatCard icon="mdi-account-group" label="Users" value={counts.users} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={triggerIngest} disabled={triggeringIngest}>
            {triggeringIngest ? 'Triggering...' : 'Trigger ingest'}
          </Button>
          <Button onClick={refetchArtists} disabled={refetchingArtists} variant="ghost">
            {refetchingArtists ? 'Refetching...' : 'Refetch artist images & data'}
          </Button>
        </div>

        <div className="space-y-3 rounded-md border border-rule bg-surface p-3">
          <h4 className="text-sm font-medium text-fg-primary">Default duplicate strategy</h4>
          <p className="text-xs text-fg-secondary">
            When a uploaded song matches an existing song by title, album, and artists, use this strategy.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              id="duplicate-strategy"
              value={duplicateStrategy}
              onChange={(e) => setDuplicateStrategy(e.target.value as DuplicateStrategy)}
              className="input w-full sm:w-auto"
              disabled={savingStrategy}
            >
              {Object.entries(DUPLICATE_STRATEGY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Button onClick={saveDuplicateStrategy} disabled={savingStrategy || !duplicateStrategy}>
              {savingStrategy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-rule bg-surface p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-fg-primary">Review folder cleanup</h4>
              <p className="text-xs text-fg-secondary">
                Files moved to the ingest review folder are automatically deleted after this many days.
              </p>
            </div>
            {retentionDays !== initialRetentionDays && (
              <Button onClick={saveRetention} disabled={savingRetention}>
                {savingRetention ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
          <select
            id="review-retention"
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="input w-full sm:w-auto"
            disabled={savingRetention}
          >
            {RETENTION_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border border-rule bg-surface p-3">
          <p className="text-sm text-fg-secondary">
            The organization pattern is now configured per library. Edit a library from the{' '}
            <a href="/admin/libraries" className="text-accent hover:underline">Libraries</a>{' '}
            page to change how uploaded and reorganized files are named.
          </p>
        </div>
      </div>

      {jobId && (
        <RenameProgressModal
          jobId={jobId}
          onClose={() => setJobId(null)}
          onComplete={(summary) =>
            notify(`Library renamed: ${summary.moved} moved, ${summary.skipped} skipped.`, 'success')
          }
        />
      )}
    </AdminShell>
  );
}
