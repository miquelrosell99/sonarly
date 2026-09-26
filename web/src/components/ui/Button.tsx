import { cn } from '../../lib/cn.js';
import { Icon } from './Icon.js';

export function Button({
  children,
  variant = 'primary',
  loading = false,
  className,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
}) {
  const variantClass = variant === 'primary' ? 'btn' : variant === 'danger' ? 'btn-danger' : 'btn-ghost';
  return (
    <button className={cn(variantClass, className)} disabled={disabled || loading} {...props}>
      {loading && (
        <Icon name="mdi-loading" size={16} className="animate-spin motion-reduce:animate-none" />
      )}
      {children}
    </button>
  );
}
