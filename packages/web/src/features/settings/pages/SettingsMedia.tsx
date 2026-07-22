import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Settings } from '../components/Settings.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface Template {
  label: string;
  value: string;
}

interface MediaSettings {
  organizePattern: string;
  templates: Template[];
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

export function SettingsMedia() {
  const { notify } = useNotification();
  const [pattern, setPattern] = useState('');
  const [initialPattern, setInitialPattern] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    api<MediaSettings>('/settings/media')
      .then((data) => {
        setPattern(data.organizePattern);
        setInitialPattern(data.organizePattern);
        setTemplates(data.templates);
        setSelectedTemplate(data.templates.find((t) => t.value === data.organizePattern)?.value ?? '');
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
    setRenaming(true);
    try {
      await api('/organize', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      notify('Library renamed.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to rename library', 'error');
    } finally {
      setRenaming(false);
    }
  };

  if (loading) {
    return (
      <Settings>
        <p className="text-sm text-gray-500">Loading...</p>
      </Settings>
    );
  }

  return (
    <Settings
      actions={
        isDirty ? (
          <Button onClick={save} disabled={saving || !pattern.trim()}>
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        ) : null
      }
    >
      <div className="max-w-2xl space-y-4">
        <h3 className="text-base font-medium">Media Management</h3>

        <div>
          <label htmlFor="template" className="mb-1 block text-sm font-medium text-gray-700">
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
          <label htmlFor="pattern" className="mb-1 block text-sm font-medium text-gray-700">
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
            <Button onClick={forceRename} disabled={renaming} variant="ghost">
              {renaming ? 'Renaming...' : 'Force rename'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Available variables: artist, albumArtist, album, title, track, track:00, disc, disc:00, year, genre. The file extension is always appended.
          </p>
        </div>

        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-500">Preview</p>
          <code className="mt-1 block break-all text-sm text-gray-800">{previewPath}</code>
        </div>
      </div>
    </Settings>
  );
}
