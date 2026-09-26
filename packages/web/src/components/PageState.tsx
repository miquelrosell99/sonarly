import { cn } from '../lib/cn.js';
import { Button } from './ui/Button.js';
import { Icon } from './ui/Icon.js';

interface PageStateProps {
  loading?: boolean;
  error?: string | Error | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Extra explanation line under the empty message (e.g. an upload pointer). */
  emptyDescription?: string;
  /** Primary action for the empty state, when one exists (e.g. "Clear filters"). */
  emptyAction?: { label: string; onClick: () => void };
  loadingMessage?: string;
  emptyIcon?: string;
  onRetry?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function PageState({
  loading,
  error,
  isEmpty,
  emptyMessage = 'No items found.',
  emptyDescription,
  emptyAction,
  loadingMessage = 'Loading...',
  emptyIcon = 'mdi-information-outline',
  onRetry,
  className,
  children,
}: PageStateProps) {
  if (loading) {
    return (
      <div
        role="status"
        className={cn('flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted', className)}
      >
        <Icon name="mdi-loading" size={24} className="animate-spin motion-reduce:animate-none" />
        <p>{loadingMessage}</p>
      </div>
    );
  }

  const errorText = error instanceof Error ? error.message : error;
  if (errorText) {
    return (
      <div
        role="alert"
        className={cn('flex flex-col items-center justify-center gap-3 py-8 text-sm text-danger', className)}
      >
        <Icon name="mdi-alert-circle-outline" size={24} />
        <p>{errorText}</p>
        {onRetry && (
          <Button variant="ghost" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted', className)}
      >
        <Icon name={emptyIcon} size={24} className="text-fg-secondary" />
        <p>{emptyMessage}</p>
        {emptyDescription && <p className="max-w-sm text-center">{emptyDescription}</p>}
        {emptyAction && (
          <Button variant="ghost" className="mt-2" onClick={emptyAction.onClick}>
            {emptyAction.label}
          </Button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
