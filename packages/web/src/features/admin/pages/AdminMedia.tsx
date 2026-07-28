import { useEffect, useState } from 'react';
import type { User, DuplicateStrategy } from '@sonarly/shared';
import { DUPLICATE_STRATEGY_LABELS } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { AdminShell } from '../components/AdminShell.js';
import { RenameProgressModal } from '../../settings/index.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

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
  const { notify } = useNotification();
  const [counts, setCounts] = useState<AdminStatusCounts['counts'] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [triggeringIngest, setTriggeringIngest] = useState(false);
  const [refetchingArtists, setRefetchingArtists] = useState(false);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy | ''>('');
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<AdminStatusCounts>('/admin/status'),
      api<{ duplicateStrategy: DuplicateStrategy }>('/settings/media'),
    ])
      .then(([statusData, settingsData]) => {
        setCounts(statusData.counts);
        setDuplicateStrategy(settingsData.duplicateStrategy);
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

  if (loading) {
    return (
      <AdminShell user={user}>
        <p className="text-sm text-muted">Loading...</p>
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
            <div className="rounded-xl border border-rule bg-surface p-3">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-accent">
                <Icon name="mdi-music" size={18} />
              </div>
              <p className="font-display text-2xl font-bold text-fg-primary">{counts.songs.toLocaleString()}</p>
              <p className="text-xs text-fg-secondary">Songs</p>
            </div>
            <div className="rounded-xl border border-rule bg-surface p-3">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-accent">
                <Icon name="mdi-album" size={18} />
              </div>
              <p className="font-display text-2xl font-bold text-fg-primary">{counts.albums.toLocaleString()}</p>
              <p className="text-xs text-fg-secondary">Albums</p>
            </div>
            <div className="rounded-xl border border-rule bg-surface p-3">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-accent">
                <Icon name="mdi-account-music" size={18} />
              </div>
              <p className="font-display text-2xl font-bold text-fg-primary">{counts.artists.toLocaleString()}</p>
              <p className="text-xs text-fg-secondary">Artists</p>
            </div>
            <div className="rounded-xl border border-rule bg-surface p-3">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-accent">
                <Icon name="mdi-account-group" size={18} />
              </div>
              <p className="font-display text-2xl font-bold text-fg-primary">{counts.users.toLocaleString()}</p>
              <p className="text-xs text-fg-secondary">Users</p>
            </div>
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
