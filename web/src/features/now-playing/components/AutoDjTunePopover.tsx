import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';
import { Input } from '../../../components/ui/Input.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { AUTO_DJ_EXCLUDE_WINDOWS } from '../../../types/index.js';
import type { AutoDjExcludeWindow, AutoDjMode } from '../../../types/index.js';

interface AutoDjTunePopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}

const modeOptions: { value: AutoDjMode; label: string; icon: string }[] = [
  { value: 'similar', label: 'Similar', icon: 'mdi-account-music' },
  { value: 'random', label: 'Random', icon: 'mdi-shuffle' },
  { value: 'smart', label: 'Smart', icon: 'mdi-brain' },
];

const excludeWindowLabels: Record<AutoDjExcludeWindow, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function computePosition(trigger: HTMLElement, panel: HTMLElement) {
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 8;
  const playBarHeight = 96;
  const maxLeft = window.innerWidth - panelRect.width - margin;
  const left = clamp(triggerRect.right - panelRect.width, margin, maxLeft);
  const top = clamp(
    triggerRect.top - panelRect.height - margin,
    margin,
    window.innerHeight - panelRect.height - margin - playBarHeight,
  );
  return { top, left };
}

// Compact Auto-DJ tuning panel (the Spotify-DJ bar): mode, discovery dial,
// exclude window, prefer-favorites, and batch size. Every control writes
// through useUpdatePreferences immediately; the discovery slider debounces
// like the Settings page so a drag commits once.
export function AutoDjTunePopover({ anchorRef, open, onClose }: AutoDjTunePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  const mode = preferences?.autoDjMode ?? 'smart';
  const batchSize = preferences?.autoDjBatchSize ?? 10;
  const excludeWindow = preferences?.autoDjExcludeWindow ?? '24h';
  const preferFavorites = preferences?.autoDjPreferFavorites ?? false;
  const discovery = preferences?.autoDjDiscovery ?? 50;

  const [batchInput, setBatchInput] = useState(String(batchSize));
  const [discoveryInput, setDiscoveryInput] = useState(discovery);
  const discoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setBatchInput(String(batchSize)), [batchSize]);
  useEffect(() => setDiscoveryInput(discovery), [discovery]);
  useEffect(() => {
    return () => {
      if (discoveryTimerRef.current) clearTimeout(discoveryTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    setStyle(computePosition(anchor, panel));
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };
    const handleResize = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (anchor && panel) setStyle(computePosition(anchor, panel));
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleMouse);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleMouse);
      window.removeEventListener('resize', handleResize);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const discoveryLabel =
    discoveryInput <= 33 ? 'Familiar' : discoveryInput >= 67 ? 'Adventurous' : 'Balanced';

  const onDiscoveryChange = (value: number) => {
    setDiscoveryInput(value);
    if (discoveryTimerRef.current) clearTimeout(discoveryTimerRef.current);
    discoveryTimerRef.current = setTimeout(() => {
      updatePreferences.mutate({ autoDjDiscovery: value });
    }, 400);
  };

  const commitBatchSize = () => {
    const next = Number(batchInput);
    if (!Number.isFinite(next)) {
      setBatchInput(String(batchSize));
      return;
    }
    const clamped = clamp(Math.round(next), 1, 50);
    setBatchInput(String(clamped));
    if (clamped !== batchSize) updatePreferences.mutate({ autoDjBatchSize: clamped });
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Auto DJ settings"
      style={style}
      className="fixed z-50 flex w-[min(19rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-rule/50 bg-surface shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-rule/50 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-primary">
          <Icon name="mdi-record-player" size={14} className="text-accent" />
          Auto DJ
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Auto DJ settings"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="mdi-close" size={18} />
        </button>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-3">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-fg-secondary">Mode</span>
          <div className="inline-flex w-full overflow-hidden rounded-md border border-rule" role="group" aria-label="Auto DJ mode">
            {modeOptions.map((option) => {
              const selected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updatePreferences.mutate({ autoDjMode: option.value })}
                  aria-pressed={selected}
                  className={cn(
                    'inline-flex min-h-[36px] flex-1 items-center justify-center gap-1 px-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    selected
                      ? 'bg-surface-hover font-medium text-accent'
                      : 'bg-surface text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
                  )}
                >
                  <Icon name={option.icon} size={13} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="autodj-tune-discovery" className="mb-1 block text-xs font-medium text-fg-secondary">
            Discovery
          </label>
          <input
            id="autodj-tune-discovery"
            type="range"
            min={0}
            max={100}
            step={1}
            value={discoveryInput}
            aria-valuetext={discoveryLabel}
            onChange={(e) => onDiscoveryChange(Number(e.target.value))}
            className="slider w-full cursor-pointer transition"
            style={{ '--slider-fill': `${discoveryInput}%` } as React.CSSProperties}
          />
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>Familiar</span>
            <span aria-hidden="true">{discoveryLabel}</span>
            <span>Adventurous</span>
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-fg-secondary">Exclude recently played</span>
          <div className="inline-flex w-full overflow-hidden rounded-md border border-rule" role="group" aria-label="Exclude recently played window">
            {AUTO_DJ_EXCLUDE_WINDOWS.map((window) => {
              const selected = excludeWindow === window;
              return (
                <button
                  key={window}
                  type="button"
                  onClick={() => updatePreferences.mutate({ autoDjExcludeWindow: window })}
                  aria-pressed={selected}
                  className={cn(
                    'min-h-[36px] flex-1 px-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    selected
                      ? 'bg-surface-hover font-medium text-accent'
                      : 'bg-surface text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
                  )}
                >
                  {excludeWindowLabels[window]}
                </button>
              );
            })}
          </div>
        </div>

        <Checkbox
          id="autodj-tune-favorites"
          checked={preferFavorites}
          onChange={(e) => updatePreferences.mutate({ autoDjPreferFavorites: e.target.checked })}
          label="Prefer favorites"
        />

        <div>
          <label htmlFor="autodj-tune-batch" className="mb-1 block text-xs font-medium text-fg-secondary">
            Batch size
          </label>
          <Input
            id="autodj-tune-batch"
            type="number"
            min={1}
            max={50}
            value={batchInput}
            onChange={(e) => setBatchInput(e.target.value)}
            onBlur={commitBatchSize}
            className="w-full"
          />
          <p className="mt-1 text-[11px] text-muted">How many tracks each refill adds.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
