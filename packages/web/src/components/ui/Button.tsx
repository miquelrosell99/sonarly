import { cn } from '../../lib/cn.js';

export function Button({
  children,
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const variantClass = variant === 'primary' ? 'btn' : variant === 'danger' ? 'btn-danger' : 'btn-ghost';
  return (
    <button className={cn(variantClass, className)} {...props}>
      {children}
    </button>
  );
}
