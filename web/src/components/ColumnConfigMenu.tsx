import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import type { ColumnConfigEntry } from '../hooks/useColumnConfig.js';

interface ColumnConfigMenuProps {
  /** Every data column in display order, including hidden ones. */
  entries: ColumnConfigEntry[];
  /** When set, a trailing locked row for the row-actions column (never hideable). */
  actionsLabel?: string;
  onToggle: (key: string) => void;
  onMove: (key: string, delta: -1 | 1) => void;
}

const MOVE_BUTTON_CLASS =
  'rounded-item p-1 text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-secondary';

/**
 * Gear-affordance popover listing a list view's columns with show/hide
 * toggles and up/down reorder buttons. Kept as a plain anchored group (not
 * an APG menu): rows mix checkboxes with move buttons, so natural Tab order
 * through the controls is the clearest keyboard flow. Escape closes the
 * popover before it reaches any enclosing modal (capture-phase swallow,
 * same convention as usePopoverMenu).
 */
export function ColumnConfigMenu({ entries, actionsLabel, onToggle, onMove }: ColumnConfigMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleMouse);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleMouse);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [open]);

  const renderRow = (
    entry: { key: string; label: string; visible: boolean; locked: boolean },
    index: number,
    total: number,
    reorderable: boolean,
  ) => (
    <li key={entry.key} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-surface-hover">
      {reorderable ? (
        <>
          <button
            type="button"
            aria-label={`Move ${entry.label} up`}
            title={`Move ${entry.label} up`}
            disabled={index === 0}
            onClick={() => onMove(entry.key, -1)}
            className={MOVE_BUTTON_CLASS}
          >
            <Icon name="mdi-chevron-up" size={16} />
          </button>
          <button
            type="button"
            aria-label={`Move ${entry.label} down`}
            title={`Move ${entry.label} down`}
            disabled={index === total - 1}
            onClick={() => onMove(entry.key, 1)}
            className={MOVE_BUTTON_CLASS}
          >
            <Icon name="mdi-chevron-down" size={16} />
          </button>
        </>
      ) : (
        <span className="flex w-16 items-center justify-center text-fg-secondary" aria-hidden>
          <Icon name="mdi-lock" size={14} />
        </span>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={entry.visible}
        disabled={entry.locked}
        aria-label={`${entry.label} column`}
        onClick={() => onToggle(entry.key)}
        className={cn(
          'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-item px-2 py-1 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          entry.locked ? 'cursor-not-allowed text-fg-secondary' : 'text-fg-primary hover:bg-surface-hover',
        )}
      >
        <span className="truncate">{entry.label}</span>
        {entry.locked && <Icon name="mdi-lock" size={13} className="shrink-0" />}
        {!entry.locked && (
          <Icon
            name="mdi-check"
            size={14}
            className={cn('shrink-0', entry.visible ? 'text-accent' : 'text-transparent')}
          />
        )}
      </button>
    </li>
  );

  const total = entries.length + (actionsLabel ? 1 : 0);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Configure columns"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center rounded-md border border-rule bg-surface p-2 text-fg-primary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="mdi-cog" size={20} />
      </button>
      {open && (
        <div
          ref={panelRef}
          role="group"
          aria-label="Column settings"
          className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg border border-rule bg-surface p-2 shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto">
            {entries.map((entry, index) => renderRow(entry, index, entries.length, true))}
            {actionsLabel &&
              renderRow(
                { key: '__actions', label: actionsLabel, visible: true, locked: true },
                total - 1,
                total,
                false,
              )}
          </ul>
        </div>
      )}
    </div>
  );
}
