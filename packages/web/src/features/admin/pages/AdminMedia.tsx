import { useEffect, useMemo, useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Icon } from '../../../components/ui/Icon.js';
import { AdminShell } from '../components/AdminShell.js';
import { RenameProgressModal } from '../../settings/index.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface Template {
  label: string;
  value: string;
}

interface MediaSettings {
  organizePattern: string;
  templates: Template[];
}

interface AdminStatusCounts {
  counts: {
    users: number;
    songs: number;
    albums: number;
    artists: number;
  };
}

const sampleTags: Record<string, string> = {
  artist: 'The Beatles',
  albumArtist: 'The Beatles',
  album: 'Abbey Road',
  title: 'Come Together',
  track: '3',
  'track:00': '03',
  disc: '1',
  'disc:00': '01',
  year: '1969',
  genre: 'Rock',
};

function sanitize(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '') || '_';
}

function buildPreviewPath(pattern: string): string {
  const patternWithoutExt = pattern.replace(/\{ext\}/g, '');
  const relativePath = patternWithoutExt.replace(/\{([a-zA-Z0-9:]+)\}/g, (_, token) => {
    return sampleTags[token] ?? '';
  });
  const sanitized = relativePath.split('/').map(sanitize).join('/');
  return `/library/${sanitized}.mp3`;
}

interface AdminMediaProps {
  user: User;
}

export function AdminMedia({ user }: AdminMediaProps) {
  const { notify } = useNotification();
  const [pattern, setPattern] = useState('');
  const [initialPattern, setInitialPattern] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [counts, setCounts] = useState<AdminStatusCounts['counts'] | null>(null);
  const [triggeringIngest, setTriggeringIngest] = useState(false);
  const [refetchingArtists, setRefetchingArtists] = useState(false);

  useEffect(() => {
    Promise.all([
      api<MediaSettings>('/settings/media'),
      api<AdminStatusCounts>('/admin/status'),
    ])
      .then(([settingsData, statusData]) => {
        setPattern(settingsData.organizePattern);
        setInitialPattern(settingsData.organizePattern);
        setTemplates(settingsData.templates);
        setSelectedTemplate(settingsData.templates.find((t) => t.value === settingsData.organizePattern)?.value ?? '');
        setCounts(statusData.counts);
      })
      .catch((err) => notify(err instanceof Error ? err.message : 'Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, [notify]);

  const previewPath = useMemo(() => buildPreviewPath(pattern), [pattern]);
  const isDirty = pattern !== initialPattern;

  const handlePatternChange = (value: string) => {
    setPattern(value);
    setSelectedTemplate(templates.find((t) => t.value === value)?.value ?? '');
  };

  const handleTemplateSelect = (value: string) => {
    setSelectedTemplate(value);
    setPattern(value);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api<{ organizePattern: string }>('/settings/media', {
        method: 'PATCH',
        body: JSON.stringify({ organizePattern: pattern }),
      });
      setInitialPattern(pattern);
      notify('Settings saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

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
          {isDirty && (
            <Button onClick={save} disabled={saving || !pattern.trim()}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          )}
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

        <div>
          <label htmlFor="template" className="mb-1 block text-sm font-medium text-fg-primary">
            Template
          </label>
          <select
            id="template"
            value={selectedTemplate}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="input"
          >
            <option value="">Select a template</option>
            {templates.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pattern" className="mb-1 block text-sm font-medium text-fg-primary">
            Organization pattern
          </label>
          <div className="flex gap-2">
            <Input
              id="pattern"
              value={pattern}
              onChange={(e) => handlePatternChange(e.target.value)}
              placeholder="{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}"
              className="flex-1"
            />
            <Button onClick={forceRename} disabled={jobId !== null} variant="ghost">
              {jobId !== null ? 'Renaming...' : 'Force rename'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted">
            Available variables: artist, albumArtist, album, title, track, track:00, disc, disc:00, year, genre. The file extension is always appended.
          </p>
        </div>

        <div className="rounded-md border border-rule bg-surface p-3">
          <p className="text-xs font-medium text-muted">Preview</p>
          <code className="mt-1 block break-all text-sm text-fg-primary">{previewPath}</code>
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
