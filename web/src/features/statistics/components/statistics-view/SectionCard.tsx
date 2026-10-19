import type { ReactNode } from 'react';
import { cn } from '../../../../lib/cn.js';
import { Icon } from '../../../../components/ui/Icon.js';
import { staggerStyle } from './format.js';

export function ShowMoreButton({ expanded, onClick, count }: { expanded: boolean; onClick: () => void; count: number }) {
  if (count <= 5) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 flex h-11 w-full items-center justify-center rounded-item text-xs font-medium text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {expanded ? 'Show less' : `Show ${count - 5} more`}
    </button>
  );
}

export function SectionCard({
  icon,
  title,
  stagger,
  children,
  className,
}: {
  icon: string;
  title: string;
  stagger: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('stat-reveal rounded-card border border-outline bg-surface p-4 sm:p-5', className)}
      style={staggerStyle(stagger)}
    >
      <div className="mb-4 flex items-center gap-2">
        <Icon name={icon} size={20} className="text-on-surface-variant" />
        <h3 className="font-display text-lg font-semibold tracking-tight text-on-surface">{title}</h3>
      </div>
      {children}
    </section>
  );
}
