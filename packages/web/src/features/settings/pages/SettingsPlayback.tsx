import { Settings } from '../components/Settings.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { Input } from '../../../components/ui/Input.js';
import type { AutoDjMode } from '@sonarly/shared';

const modeOptions: { value: AutoDjMode; label: string }[] = [
  { value: 'similar', label: 'Similar — same artist, album, or genre' },
  { value: 'random', label: 'Random — anything from your library' },
  { value: 'smart', label: 'Smart — match mood, tempo, and taste' },
];

export function SettingsPlayback() {
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  const enabled = preferences?.autoDjEnabled ?? false;
  const mode = preferences?.autoDjMode ?? 'smart';
  const threshold = preferences?.autoDjTopUpThreshold ?? 5;
  const batchSize = preferences?.autoDjBatchSize ?? 10;

  const setEnabled = (next: boolean) => updatePreferences.mutate({ autoDjEnabled: next });
  const setMode = (next: AutoDjMode) => updatePreferences.mutate({ autoDjMode: next });
  const setThreshold = (next: number) => updatePreferences.mutate({ autoDjTopUpThreshold: next });
  const setBatchSize = (next: number) => updatePreferences.mutate({ autoDjBatchSize: next });

  return (
    <Settings>
      <div className="w-full max-w-xl space-y-8">
        <section>
          <h3 className="mb-4 text-base font-medium">Auto DJ</h3>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm">Automatically add songs when the queue runs low</span>
          </label>
        </section>

        <section>
          <h3 className="mb-4 text-base font-medium">DJ mode</h3>
          <div className="space-y-2">
            {modeOptions.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition ${
                  mode === option.value
                    ? 'border-accent bg-surface-hover'
                    : 'border-rule bg-surface hover:bg-surface-hover'
                }`}
              >
                <input
                  type="radio"
                  name="auto-dj-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  className="h-4 w-4 accent-accent"
                />
                <span className="text-sm">{option.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Top-up threshold</label>
            <p className="mb-2 text-xs text-muted">Fetch more tracks when this many remain.</p>
            <Input
              type="number"
              min={1}
              max={20}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Batch size</label>
            <p className="mb-2 text-xs text-muted">How many tracks to fetch at once.</p>
            <Input
              type="number"
              min={1}
              max={50}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </section>
      </div>
    </Settings>
  );
}
