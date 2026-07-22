import { cn } from '../../lib/cn.js';

export function Button({
  children,
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  return (
    <button className={cn(variant === 'primary' ? 'btn' : 'btn-ghost', className)} {...props}>
      {children}
    </button>
  );
}
