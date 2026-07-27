import { cn } from '../lib/cn.js';
import { MetadataBreadcrumb, type MetadataItem } from './MetadataBreadcrumb.js';

interface EntityHeaderProps {
  type: string;
  title: string;
  cover?: React.ReactNode;
  metadata?: MetadataItem[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  blurCover?: boolean;
}

export function EntityHeader({
  type,
  title,
  cover,
  metadata,
  actions,
  children,
  className,
  blurCover,
}: EntityHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-6 sm:flex-row sm:items-end', className)}>
      {cover && (
        <div className={cn('shrink-0 shadow-lg', blurCover && 'blur-sm')}>
          {cover}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-fg-secondary">{type}</span>
        <h1 className="text-2xl font-bold text-fg-primary sm:text-3xl">{title}</h1>
        {metadata && metadata.length > 0 && <MetadataBreadcrumb items={metadata} />}
        {actions && <div className="mt-1 flex flex-wrap items-center gap-3">{actions}</div>}
        {children}
      </div>
    </div>
  );
}
