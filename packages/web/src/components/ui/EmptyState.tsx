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

// Design-token-consistent empty state: icon + one-line explanation + an
// optional primary action. Sentence case, plain verbs (design-language tone).
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
      <Icon name={icon} size={24} className="text-fg-secondary" />
      <p className="font-medium text-fg-primary">{title}</p>
      {description && <p className="max-w-sm text-muted">{description}</p>}
      {actionLabel && (
        <Button variant="ghost" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
