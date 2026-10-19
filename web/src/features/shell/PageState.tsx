import { cn } from '../../lib/cn.js';
import { useDelayedVisible } from '../../hooks/useDelayedVisible.js';
import { Button } from '../../components/ui/button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { Icon } from '../../components/ui/Icon.js';

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
  const showSpinner = useDelayedVisible(!!loading, 300);
  if (loading) {
    // Loading choreography: the container keeps its place from the first
    // frame; only the spinner + message appear, and only after 300 ms.
    return (
      <div
        role="status"
        className={cn('flex flex-col items-center justify-center gap-2 py-8 text-sm text-on-surface-variant', className)}
      >
        {showSpinner && (
          <>
            <Icon name="mdi-loading" size={24} className="animate-spin motion-reduce:animate-none" />
            <p>{loadingMessage}</p>
          </>
        )}
      </div>
    );
  }

  const errorText = error instanceof Error ? error.message : error;
  if (errorText) {
    return (
      <div
        role="alert"
        className={cn('flex flex-col items-center justify-center gap-3 py-8 text-sm text-error', className)}
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
    // One empty-state implementation: the shared EmptyState owns the icon,
    // heading, and primary CTA treatment.
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyMessage}
        description={emptyDescription}
        actionLabel={emptyAction?.label}
        onAction={emptyAction?.onClick}
        className={className}
      />
    );
  }

  return <>{children}</>;
}
