import { useState, useEffect } from 'react';
import { Settings } from '../components/Settings.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { Input } from '../../../components/ui/Input.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';
import { Icon } from '../../../components/ui/Icon.js';
import type { AutoDjMode } from '@sonarly/shared';

const modeOptions: {
  value: AutoDjMode;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    value: 'similar',
    label: 'Similar',
    description: 'Same artist, album, or genre',
    icon: 'mdi-account-music',
  },
  {
    value: 'random',
    label: 'Random',
    description: 'Anything from your library',
    icon: 'mdi-shuffle',
  },
  {
    value: 'smart',
    label: 'Smart',
    description: 'Match mood, tempo, and taste',
    icon: 'mdi-brain',
  },
];

export function SettingsPlayback() {
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  const enabled = preferences?.autoDjEnabled ?? false;
  const mode = preferences?.autoDjMode ?? 'smart';
  const threshold = preferences?.autoDjTopUpThreshold ?? 5;
  const batchSize = preferences?.autoDjBatchSize ?? 10;

  const [thresholdInput, setThresholdInput] = useState(String(threshold));
  const [batchSizeInput, setBatchSizeInput] = useState(String(batchSize));

  useEffect(() => {
    setThresholdInput(String(threshold));
  }, [threshold]);

  useEffect(() => {
    setBatchSizeInput(String(batchSize));
  }, [batchSize]);

  const setEnabled = (next: boolean) => updatePreferences.mutate({ autoDjEnabled: next });
  const setMode = (next: AutoDjMode) => updatePreferences.mutate({ autoDjMode: next });

  const clampThreshold = (value: number) => Math.min(20, Math.max(1, value));
  const clampBatchSize = (value: number) => Math.min(50, Math.max(1, value));

  const commitThreshold = () => {
    const next = Number(thresholdInput);
    if (!Number.isFinite(next)) {
      setThresholdInput(String(threshold));
      return;
    }
    const clamped = clampThreshold(next);
    setThresholdInput(String(clamped));
    updatePreferences.mutate({ autoDjTopUpThreshold: clamped });
  };

  const commitBatchSize = () => {
    const next = Number(batchSizeInput);
    if (!Number.isFinite(next)) {
      setBatchSizeInput(String(batchSize));
      return;
    }
    const clamped = clampBatchSize(next);
    setBatchSizeInput(String(clamped));
    updatePreferences.mutate({ autoDjBatchSize: clamped });
  };

  return (
    <Settings>
      <div className="w-full max-w-xl space-y-8">
        <section>
          <h3 className="mb-4 text-base font-medium">Auto DJ</h3>
          <Checkbox
            id="auto-dj-enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            label="Automatically add songs when the queue runs low"
          />
        </section>

        <section>
          <h3 className="mb-4 text-base font-medium">DJ mode</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {modeOptions.map((option) => {
              const selected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  aria-pressed={selected}
                  className={`flex flex-col items-center gap-2 rounded-md border px-4 py-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    selected
                      ? 'border-accent bg-surface-hover text-accent'
                      : 'border-rule bg-surface text-fg-secondary hover:bg-surface-hover hover:text-fg-primary'
                  }`}
                >
                  <Icon name={option.icon} size={24} />
                  <div>
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs opacity-80">{option.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="auto-dj-threshold" className="mb-1 block text-sm font-medium">Top-up threshold</label>
            <p className="mb-2 text-xs text-muted">Fetch more tracks when this many remain.</p>
            <Input
              id="auto-dj-threshold"
              type="number"
              min={1}
              max={20}
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              onBlur={commitThreshold}
              className="w-full"
            />
          </div>
          <div>
            <label htmlFor="auto-dj-batch-size" className="mb-1 block text-sm font-medium">Batch size</label>
            <p className="mb-2 text-xs text-muted">How many tracks to fetch at once.</p>
            <Input
              id="auto-dj-batch-size"
              type="number"
              min={1}
              max={50}
              value={batchSizeInput}
              onChange={(e) => setBatchSizeInput(e.target.value)}
              onBlur={commitBatchSize}
              className="w-full"
            />
          </div>
        </section>
      </div>
    </Settings>
  );
}
