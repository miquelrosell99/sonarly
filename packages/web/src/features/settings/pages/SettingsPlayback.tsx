import { useState, useEffect, useRef } from 'react';
import { Settings } from '../components/Settings.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { Input } from '../../../components/ui/Input.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';
import { Icon } from '../../../components/ui/Icon.js';
import { AUTO_DJ_EXCLUDE_WINDOWS } from '@sonarly/shared';
import type { AutoDjMode, AutoDjExcludeWindow } from '@sonarly/shared';

const modeOptions: {
  value: AutoDjMode;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    value: 'similar',
    label: 'Similar',
    description: 'Stays in the neighborhood: artist, album, and genre of what\'s playing.',
    icon: 'mdi-account-music',
  },
  {
    value: 'random',
    label: 'Random',
    description: 'Anything from your library, skipping what you heard recently.',
    icon: 'mdi-shuffle',
  },
  {
    value: 'smart',
    label: 'Smart',
    description: 'Ranks your library by mood, tempo, ratings, and taste.',
    icon: 'mdi-brain',
  },
];

const excludeWindowOptions: { value: AutoDjExcludeWindow; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export function SettingsPlayback() {
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  const enabled = preferences?.autoDjEnabled ?? false;
  const mode = preferences?.autoDjMode ?? 'smart';
  const threshold = preferences?.autoDjTopUpThreshold ?? 5;
  const batchSize = preferences?.autoDjBatchSize ?? 10;
  const excludeWindow = preferences?.autoDjExcludeWindow ?? '24h';
  const preferFavorites = preferences?.autoDjPreferFavorites ?? false;
  const discovery = preferences?.autoDjDiscovery ?? 50;

  const [thresholdInput, setThresholdInput] = useState(String(threshold));
  const [batchSizeInput, setBatchSizeInput] = useState(String(batchSize));
  const [discoveryInput, setDiscoveryInput] = useState(discovery);
  const discoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setThresholdInput(String(threshold));
  }, [threshold]);

  useEffect(() => {
    setBatchSizeInput(String(batchSize));
  }, [batchSize]);

  useEffect(() => {
    setDiscoveryInput(discovery);
  }, [discovery]);

  useEffect(() => {
    return () => {
      if (discoveryTimerRef.current) clearTimeout(discoveryTimerRef.current);
    };
  }, []);

  const setEnabled = (next: boolean) => updatePreferences.mutate({ autoDjEnabled: next });
  const setMode = (next: AutoDjMode) => updatePreferences.mutate({ autoDjMode: next });
  const setExcludeWindow = (next: AutoDjExcludeWindow) => {
    if (AUTO_DJ_EXCLUDE_WINDOWS.includes(next)) {
      updatePreferences.mutate({ autoDjExcludeWindow: next });
    }
  };
  const setPreferFavorites = (next: boolean) => {
    updatePreferences.mutate({ autoDjPreferFavorites: next });
  };

  // Debounced: dragging the slider fires many changes, commit once it settles.
  const onDiscoveryChange = (value: number) => {
    setDiscoveryInput(value);
    if (discoveryTimerRef.current) clearTimeout(discoveryTimerRef.current);
    discoveryTimerRef.current = setTimeout(() => {
      updatePreferences.mutate({ autoDjDiscovery: value });
    }, 400);
  };

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

  const discoveryLabel =
    discoveryInput <= 33 ? 'Familiar' : discoveryInput >= 67 ? 'Adventurous' : 'Balanced';

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

        <section>
          <h3 className="mb-4 text-base font-medium">Taste</h3>
          <div className="space-y-6">
            <div>
              <span id="auto-dj-exclude-window-label" className="mb-1 block text-sm font-medium">
                Exclude recently played
              </span>
              <p className="mb-2 text-xs text-muted">
                Tracks you heard within this window are never queued.
              </p>
              <div
                role="group"
                aria-labelledby="auto-dj-exclude-window-label"
                className="inline-flex overflow-hidden rounded-md border border-rule"
              >
                {excludeWindowOptions.map((option) => {
                  const selected = excludeWindow === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setExcludeWindow(option.value)}
                      aria-pressed={selected}
                      className={`min-h-[44px] px-4 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        selected
                          ? 'bg-surface-hover font-medium text-accent'
                          : 'bg-surface text-fg-secondary hover:bg-surface-hover hover:text-fg-primary'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Checkbox
              id="auto-dj-prefer-favorites"
              checked={preferFavorites}
              onChange={(e) => setPreferFavorites(e.target.checked)}
              label="Prefer favorites"
              description="Starred tracks are ranked ahead of everything else."
            />

            <div>
              <label htmlFor="auto-dj-discovery" className="mb-1 block text-sm font-medium">
                Discovery
              </label>
              <p className="mb-2 text-xs text-muted">
                Lean on tracks you already love, or dig for deep cuts.
              </p>
              <input
                id="auto-dj-discovery"
                type="range"
                min={0}
                max={100}
                step={1}
                value={discoveryInput}
                aria-valuetext={discoveryLabel}
                onChange={(e) => onDiscoveryChange(Number(e.target.value))}
                className="slider h-2 w-full cursor-pointer rounded-full text-fg-primary transition"
                style={
                  {
                    background: `linear-gradient(to right, hsl(var(--accent)) 0%, hsl(var(--accent)) ${discoveryInput}%, hsl(var(--fg-primary) / 0.1) ${discoveryInput}%, hsl(var(--fg-primary) / 0.1) 100%)`,
                  } as React.CSSProperties
                }
              />
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>Familiar</span>
                <span aria-hidden="true">{discoveryLabel}</span>
                <span>Adventurous</span>
              </div>
            </div>
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
