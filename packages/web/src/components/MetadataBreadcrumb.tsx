import { Link } from 'wouter';
import { cn } from '../lib/cn.js';

export interface MetadataItem {
  label: string;
  href?: string;
}

interface MetadataBreadcrumbProps {
  items: MetadataItem[];
  className?: string;
}

export function MetadataBreadcrumb({ items, className }: MetadataBreadcrumbProps) {
  const visible = items.filter((item) => item.label !== '' && item.label !== undefined);
  if (visible.length === 0) return null;

  return (
    <p className={cn('text-sm text-fg-secondary', className)}>
      {visible.map((item, index) => {
        const isLast = index === visible.length - 1;
        const content = item.href ? (
          <Link
            href={item.href}
            className={cn('transition hover:opacity-70', index === 0 && 'font-medium text-fg-primary')}
          >
            {item.label}
          </Link>
        ) : (
          <span className={cn(index === 0 && 'font-medium text-fg-primary')}>{item.label}</span>
        );
        return (
          <span key={`${item.label}-${index}`}>
            {content}
            {!isLast && <span className="mx-1">•</span>}
          </span>
        );
      })}
    </p>
  );
}
