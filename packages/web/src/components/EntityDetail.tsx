import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { EntityHeader } from './EntityHeader.js';
import { type MetadataItem } from './MetadataBreadcrumb.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export interface EntityDetailProps {
  isLoading?: boolean;
  error?: string | null;
  notFound?: boolean;
  notFoundMessage?: string;
  documentTitle?: string | null;
  type: string;
  title?: string;
  cover?: ReactNode;
  metadata?: MetadataItem[];
  actions?: ReactNode;
  headerChildren?: ReactNode;
  renderHeader?: (header: React.ReactElement) => React.ReactElement;
  children?: ReactNode;
  className?: string;
}

export function EntityDetail({
  isLoading,
  error,
  notFound,
  notFoundMessage,
  documentTitle,
  type,
  title,
  cover,
  metadata,
  actions,
  headerChildren,
  renderHeader,
  children,
  className,
}: EntityDetailProps) {
  useDocumentTitle(documentTitle);

  if (isLoading) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (notFound || !title) {
    return <p className="text-sm text-muted">{notFoundMessage ?? `${type} not found.`}</p>;
  }

  const header = (
    <EntityHeader type={type} title={title} cover={cover} metadata={metadata} actions={actions}>
      {headerChildren}
    </EntityHeader>
  );

  return (
    <div className={cn(className)}>
      {renderHeader ? renderHeader(header) : header}
      {children}
    </div>
  );
}
