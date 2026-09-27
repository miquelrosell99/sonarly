import { cn } from '../../lib/cn.js';
import { Icon } from '../ui/Icon.js';

export const CHIP_BUTTON_CLASS =
  'rounded-full p-0.5 text-fg-secondary transition hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-fg-secondary';

export const CHIP_SHELL_CLASS =
  'group/chip inline-flex items-center gap-0.5 rounded-full bg-surface-hover py-0.5 text-sm text-fg-primary';

export function chipShellClass(padded: boolean, isDragging?: boolean): string {
  return cn(CHIP_SHELL_CLASS, padded ? 'px-2.5' : 'pl-1 pr-2', isDragging && 'relative z-10 opacity-60');
}

/**
 * Move-left/move-right controls shared by the plain and the drag-sortable
 * chip renderers — the keyboard-accessible reorder path that works with or
 * without the dnd-kit chunk loaded.
 */
export function ChipMoveButtons({
  value,
  index,
  total,
  onMove,
}: {
  value: string;
  index: number;
  total: number;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <span className="inline-flex items-center opacity-0 transition group-hover/chip:opacity-100 group-focus-within/chip:opacity-100">
      <button
        type="button"
        aria-label={`Move ${value} left`}
        title={`Move ${value} left`}
        disabled={index === 0}
        onClick={(e) => {
          e.stopPropagation();
          onMove(-1);
        }}
        className={CHIP_BUTTON_CLASS}
      >
        <Icon name="mdi-chevron-left" size={13} />
      </button>
      <button
        type="button"
        aria-label={`Move ${value} right`}
        title={`Move ${value} right`}
        disabled={index === total - 1}
        onClick={(e) => {
          e.stopPropagation();
          onMove(1);
        }}
        className={CHIP_BUTTON_CLASS}
      >
        <Icon name="mdi-chevron-right" size={13} />
      </button>
    </span>
  );
}

export function ChipRemoveButton({
  value,
  onRemove,
}: {
  value: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={`Remove ${value}`}
      title={`Remove ${value}`}
      className={CHIP_BUTTON_CLASS}
    >
      <Icon name="mdi-close" size={14} />
    </button>
  );
}
