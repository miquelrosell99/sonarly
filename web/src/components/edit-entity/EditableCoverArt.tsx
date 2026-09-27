import { cn } from '../../lib/cn.js';
import { CoverArt } from '../CoverArt.js';
import { Icon } from '../ui/Icon.js';

export function EditableCoverArt({
  coverArt,
  alt,
  readOnly,
  busy,
  onEdit,
  onRequestDelete,
  onView,
  className,
}: {
  coverArt?: string;
  alt: string;
  readOnly?: boolean;
  busy?: boolean;
  onEdit?: () => void;
  onRequestDelete?: () => void;
  onView?: () => void;
  className?: string;
}) {
  const editable = !readOnly && (onEdit || onRequestDelete);
  return (
    <div
      className={cn(
        'group relative aspect-square h-40 w-40 overflow-hidden rounded-xl bg-surface-hover',
        onView && 'cursor-pointer',
        className,
      )}
      onClick={onView}
      role={onView ? 'button' : undefined}
      tabIndex={onView ? 0 : undefined}
      onKeyDown={
        onView
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onView();
              }
            }
          : undefined
      }
      aria-label={onView ? 'View cover art' : undefined}
    >
      <CoverArt coverArt={coverArt} alt={alt} className="h-full w-full" iconSize={40} />
      {editable && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              disabled={busy}
              aria-label="Change cover art"
              title="Change cover art"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-fg-primary shadow-sm transition hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="mdi-pencil" size={18} />
            </button>
          )}
          {onRequestDelete && coverArt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete();
              }}
              disabled={busy}
              aria-label="Remove cover art"
              title="Remove cover art"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-fg-primary shadow-sm transition hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="mdi-delete" size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
