import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

type ExplicitTitleProps = {
  explicit?: boolean;
  blur?: boolean;
  className?: string;
} & ({ title: string; children?: never } | { title?: never; children: ReactNode });

export function ExplicitTitle({ title, children, explicit, blur, className }: ExplicitTitleProps) {
  return (
    <span className={cn('inline', blur && explicit && 'blur-sm', className)}>
      {children ?? title}
      {explicit && (
        <span
          role="img"
          aria-label="Explicit"
          className="ml-1.5 inline-flex h-[1.25em] min-w-[1.25em] items-center justify-center rounded bg-accent/10 px-[0.35em] align-middle text-[0.65em] font-bold leading-none text-accent"
        >
          E
        </span>
      )}
    </span>
  );
}
