import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

interface Template {
  label: string;
  value: string;
}

interface MediaSettings {
  organizePattern: string;
  templates: Template[];
}

export function SettingsMedia() {
  const [pattern, setPattern] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<MediaSettings>('/settings/media')
      .then((data) => {
        setPattern(data.organizePattern);
        setTemplates(data.templates);
        setSelectedTemplate(data.templates.find((t) => t.value === data.organizePattern)?.value ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handlePatternChange = (value: string) => {
    setPattern(value);
    setSelectedTemplate(templates.find((t) => t.value === value)?.value ?? '');
    setSaved(false);
  };

  const handleTemplateSelect = (value: string) => {
    setSelectedTemplate(value);
    setPattern(value);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api<{ organizePattern: string }>('/settings/media', {
        method: 'PATCH',
        body: JSON.stringify({ organizePattern: pattern }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading...</p>;
  }

  return (
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
        <Input
          id="pattern"
          value={pattern}
          onChange={(e) => handlePatternChange(e.target.value)}
          placeholder="{artist}/{album}/{track:00} - {title}{ext}"
        />
        <p className="mt-1 text-xs text-gray-500">
          Available variables: artist, albumArtist, album, title, track, track:00, disc, year, genre, ext.
        </p>
      </div>

      <Button onClick={save} disabled={saving || !pattern.trim()}>
        Save
      </Button>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm text-gray-700">Settings saved.</p>}
    </div>
  );
}
