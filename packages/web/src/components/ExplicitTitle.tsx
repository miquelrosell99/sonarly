import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

type ExplicitTitleProps = {
  explicit?: boolean;
  blur?: boolean;
  className?: string;
} & ({ title: string; children?: never } | { title?: never; children: ReactNode });

export function ExplicitTitle({ title, children, explicit, blur, className }: ExplicitTitleProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', blur && explicit && 'blur-sm', className)}>
      {children ?? title}
      {explicit && (
        <span aria-label="Explicit" className="rounded bg-red-500/10 px-1 text-[10px] font-bold text-red-500">E</span>
      )}
    </span>
  );
}
