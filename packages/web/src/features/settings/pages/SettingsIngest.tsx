import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Settings } from '../components/Settings.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

const RETENTION_OPTIONS = [30, 60, 90];

export function SettingsIngest() {
  const { notify } = useNotification();
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [initialRetentionDays, setInitialRetentionDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isDirty = retentionDays !== initialRetentionDays;

  useEffect(() => {
    api<{ reviewRetentionDays: number }>('/settings')
      .then((r) => {
        setRetentionDays(r.reviewRetentionDays);
        setInitialRetentionDays(r.reviewRetentionDays);
      })
      .catch((err) => notify(err instanceof Error ? err.message : 'Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, [notify]);

  const save = async () => {
    setSaving(true);
    try {
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({ reviewRetentionDays: retentionDays }),
      });
      setInitialRetentionDays(retentionDays);
      notify('Settings saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Settings>
        <p className="text-sm text-muted">Loading...</p>
      </Settings>
    );
  }

  return (
    <Settings
      actions={
        isDirty ? (
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        ) : null
      }
    >
      <div className="max-w-2xl space-y-4">
        <h3 className="text-base font-medium">Ingest Cleanup</h3>

        <div>
          <label htmlFor="retention" className="mb-1 block text-sm font-medium text-fg-primary">
            Review folder cleanup
          </label>
          <p className="mb-2 text-sm text-muted">
            Files moved to the ingest review folder are automatically deleted after this many days.
          </p>
          <select
            id="retention"
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="input"
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
    </Settings>
  );
}
