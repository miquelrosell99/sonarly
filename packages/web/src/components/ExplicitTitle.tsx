import { cn } from '../lib/cn.js';

interface ExplicitTitleProps {
  title: string;
  explicit?: boolean;
  blur?: boolean;
  className?: string;
}

export function ExplicitTitle({ title, explicit, blur, className }: ExplicitTitleProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', blur && explicit && 'blur-sm', className)}>
      {title}
      {explicit && (
        <span className="rounded bg-red-500/10 px-1 text-[10px] font-bold text-red-500">E</span>
      )}
    </span>
  );
}
