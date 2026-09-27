import { useId } from 'react';
import { cn } from '../../lib/cn.js';

/**
 * Titled section of the entity editor (core metadata / artists & credits /
 * classification / artwork / lyrics). The heading reuses the EntityHeader
 * eyebrow style so the modal hierarchy matches the rest of the app; the
 * section is a labelled landmark so keyboard/AT users can jump between
 * groups.
 */
export function EditorSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('min-w-0', className)}>
      <h4
        id={headingId}
        className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-secondary"
      >
        {title}
      </h4>
      {children}
    </section>
  );
}
