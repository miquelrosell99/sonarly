import { cn } from '../../lib/cn.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';

interface EmptyStateProps {
  icon?: string;
  title: string;
  /** One-line explanation shown under the title. */
  description?: string;
  /** Primary action, when one exists (e.g. "Clear filters"). */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

// Design-token-consistent empty state: icon + heading + one-line explanation
// + an optional primary action. Sentence case, plain verbs (design-language
// tone). The title is a real heading; the CTA is the accent button.
export function EmptyState({
  icon = 'mdi-information-outline',
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2 py-8 text-center text-sm', className)}
    >
      <Icon name={icon} size={44} className="text-on-surface-variant" />
      <h2 className="font-semibold text-on-surface">{title}</h2>
      {description && <p className="max-w-sm text-on-surface-variant">{description}</p>}
      {actionLabel && (
        <Button className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
