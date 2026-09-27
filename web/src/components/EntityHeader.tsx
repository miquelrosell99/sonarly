import { cn } from '../lib/cn.js';
import { MetadataBreadcrumb, type MetadataItem } from './MetadataBreadcrumb.js';

interface EntityHeaderProps {
  type: string;
  title: React.ReactNode;
  cover?: React.ReactNode;
  metadata?: MetadataItem[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  blurCover?: boolean;
  /**
   * Wraps the cover and the title so right-click opens the entity's context
   * menu at the pointer (visual output is unchanged — behavior only).
   */
  wrapContextTarget?: (target: React.ReactElement) => React.ReactElement;
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
  wrapContextTarget,
}: EntityHeaderProps) {
  const coverElement = cover ? (
    <div className={cn('shrink-0 shadow-lg', blurCover && 'blur-sm')}>
      {cover}
    </div>
  ) : null;

  const titleElement = (
    <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary sm:text-3xl">
      {title}
    </h1>
  );

  return (
    <div className={cn('mb-6 flex flex-col gap-6 sm:flex-row sm:items-start', className)}>
      {coverElement && (wrapContextTarget ? wrapContextTarget(coverElement) : coverElement)}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-fg-secondary">{type}</span>
        {wrapContextTarget ? wrapContextTarget(titleElement) : titleElement}
        {metadata && metadata.length > 0 && <MetadataBreadcrumb items={metadata} />}
        {actions && <div className="mt-1 flex flex-wrap items-center gap-3">{actions}</div>}
        {children}
      </div>
    </div>
  );
}
