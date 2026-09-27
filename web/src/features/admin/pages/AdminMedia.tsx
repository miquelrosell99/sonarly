import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User, DuplicateStrategy } from '../../../types';
import { DUPLICATE_STRATEGY_LABELS } from '../../../types';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { PageState } from '../../../components/PageState.js';
import { AdminShell } from '../components/AdminShell.js';
import { SettingsCard } from '../../settings/index.js';
import { StatCard } from '../components/StatCard.js';
import { RenameProgressModal } from '../../settings/index.js';
import { useSaveBar } from '../../../components/ui/SaveBar.js';
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

interface MediaSettingsForm {
  duplicateStrategy: DuplicateStrategy;
  reviewRetentionDays: number;
}

interface AdminMediaProps {
  user: User;
}

export function AdminMedia({ user }: AdminMediaProps) {
  const { refresh } = useAdminRefresh();
  const { notify } = useNotification();
  const [counts, setCounts] = useState<AdminStatusCounts['counts'] | null>(null);
  const [initialSettings, setInitialSettings] = useState<MediaSettingsForm | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [triggeringIngest, setTriggeringIngest] = useState(false);
  const [refetchingArtists, setRefetchingArtists] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<AdminStatusCounts>('/admin/status'),
      api<MediaSettingsForm>('/settings/media'),
    ])
      .then(([statusData, settingsData]) => {
        setCounts(statusData.counts);
        setInitialSettings(settingsData);
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

  if (loading || !initialSettings) {
    return (
      <AdminShell user={user}>
        <PageState loading>{null}</PageState>
      </AdminShell>
    );
  }

  return (
    <AdminShell user={user}>
      <AdminMediaBody
        counts={counts}
        initialSettings={initialSettings}
        onForceRename={forceRename}
        renaming={jobId !== null}
        onTriggerIngest={triggerIngest}
        triggeringIngest={triggeringIngest}
        onRefetchArtists={refetchArtists}
        refetchingArtists={refetchingArtists}
      />
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

interface AdminMediaBodyProps {
  counts: AdminStatusCounts['counts'] | null;
  initialSettings: MediaSettingsForm;
  onForceRename: () => void;
  renaming: boolean;
  onTriggerIngest: () => void;
  triggeringIngest: boolean;
  onRefetchArtists: () => void;
  refetchingArtists: boolean;
}

/**
 * Renders inside AdminShell, so its useSaveBar registration lands within the
 * shell's SaveBarProvider — the bar appears next to the Admin panel title.
 */
function AdminMediaBody({
  counts,
  initialSettings,
  onForceRename,
  renaming,
  onTriggerIngest,
  triggeringIngest,
  onRefetchArtists,
  refetchingArtists,
}: AdminMediaBodyProps) {
  const { notify } = useNotification();
  const [baseline, setBaseline] = useState(initialSettings);
  const [form, setForm] = useState(initialSettings);
  const [saving, setSaving] = useState(false);

  const dirty =
    form.duplicateStrategy !== baseline.duplicateStrategy ||
    form.reviewRetentionDays !== baseline.reviewRetentionDays;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (form.duplicateStrategy !== baseline.duplicateStrategy) {
        body.duplicateStrategy = form.duplicateStrategy;
      }
      if (form.reviewRetentionDays !== baseline.reviewRetentionDays) {
        body.reviewRetentionDays = form.reviewRetentionDays;
      }
      await api('/settings/media', { method: 'PATCH', body: JSON.stringify(body) });
      setBaseline(form);
      notify('Settings saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }, [form, baseline, notify]);

  const discard = useCallback(() => setForm(baseline), [baseline]);

  const controller = useMemo(
    () => (dirty ? { dirty, saving, onSave: save, onDiscard: discard } : null),
    [dirty, saving, save, discard],
  );
  useSaveBar(controller);

  return (
    <div className="w-full max-w-4xl space-y-6">
      {counts && (
        <SettingsCard icon="mdi-chart-bar" title="Library overview" description="What this server currently holds.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon="mdi-music" label="Songs" value={counts.songs} />
            <StatCard icon="mdi-album" label="Albums" value={counts.albums} />
            <StatCard icon="mdi-account-music" label="Artists" value={counts.artists} />
            <StatCard icon="mdi-account-group" label="Users" value={counts.users} />
          </div>
        </SettingsCard>
      )}

      <SettingsCard
        icon="mdi-wrench-outline"
        title="Maintenance"
        description="Jobs that scan, organize and enrich the library."
        actions={
          <Button onClick={onForceRename} disabled={renaming} variant="ghost">
            {renaming ? 'Renaming...' : 'Force rename'}
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={onTriggerIngest} disabled={triggeringIngest}>
            {triggeringIngest ? 'Triggering...' : 'Trigger ingest'}
          </Button>
          <Button onClick={onRefetchArtists} disabled={refetchingArtists} variant="ghost">
            {refetchingArtists ? 'Refetching...' : 'Refetch artist images & data'}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard
        icon="mdi-cog"
        title="Ingest settings"
        description="Applied to new uploads and scans. The organization pattern is configured per library — edit a library to change how files are named."
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="duplicate-strategy" className="mb-1 block text-sm font-medium">
              Default duplicate strategy
            </label>
            <p className="mb-2 text-xs text-muted">
              When an uploaded song matches an existing song by title, album, and artists.
            </p>
            <select
              id="duplicate-strategy"
              value={form.duplicateStrategy}
              onChange={(e) => setForm((prev) => ({ ...prev, duplicateStrategy: e.target.value as DuplicateStrategy }))}
              className="input w-full"
              disabled={saving}
            >
              {Object.entries(DUPLICATE_STRATEGY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="review-retention" className="mb-1 block text-sm font-medium">
              Review folder cleanup
            </label>
            <p className="mb-2 text-xs text-muted">
              Files moved to the ingest review folder are deleted after this many days.
            </p>
            <select
              id="review-retention"
              value={form.reviewRetentionDays}
              onChange={(e) => setForm((prev) => ({ ...prev, reviewRetentionDays: Number(e.target.value) }))}
              className="input w-full"
              disabled={saving}
            >
              {RETENTION_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
