import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { EntityHeader } from './EntityHeader.js';
import { PageState } from './PageState.js';
import { type MetadataItem } from './MetadataBreadcrumb.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export interface EntityDetailProps {
  isLoading?: boolean;
  error?: string | null;
  notFound?: boolean;
  notFoundMessage?: string;
  documentTitle?: string | null;
  type: string;
  title?: React.ReactNode;
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
    return <PageState loading>{null}</PageState>;
  }

  if (error) {
    return <PageState error={error}>{null}</PageState>;
  }

  if (notFound || !title) {
    return <PageState isEmpty emptyMessage={notFoundMessage ?? `${type} not found.`}>{null}</PageState>;
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
