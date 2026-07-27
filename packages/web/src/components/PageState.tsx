import { cn } from '../lib/cn.js';

interface PageStateProps {
  loading?: boolean;
  error?: string | Error | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
  className?: string;
  children: React.ReactNode;
}

export function PageState({
  loading,
  error,
  isEmpty,
  emptyMessage = 'No items found.',
  loadingMessage = 'Loading...',
  className,
  children,
}: PageStateProps) {
  if (loading) return <p className={cn('text-sm text-muted', className)}>{loadingMessage}</p>;

  const errorText = error instanceof Error ? error.message : error;
  if (errorText) return <p className={cn('text-sm text-danger', className)}>{errorText}</p>;

  if (isEmpty) return <p className={cn('text-sm text-muted', className)}>{emptyMessage}</p>;

  return <>{children}</>;
}
