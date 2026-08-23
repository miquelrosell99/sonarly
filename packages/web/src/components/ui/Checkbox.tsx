import { useRef, useEffect } from 'react';
import { cn } from '../../lib/cn.js';
import { Icon } from './Icon.js';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  indeterminate?: boolean;
}

export function Checkbox({ label, description, className, id, indeterminate, ...props }: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate ?? false;
    }
  }, [indeterminate]);

  return (
    <label
      htmlFor={id}
      className={cn(
        'group -m-3 flex cursor-pointer items-start gap-3 p-3',
        props.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            'absolute inset-0 rounded-md border border-rule bg-surface transition',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-bg-primary',
            'peer-checked:border-accent peer-checked:bg-accent',
            indeterminate && 'border-accent bg-accent',
          )}
        />
        <Icon
          name="mdi-check"
          size={14}
          className={cn(
            'relative z-10 text-bg-primary opacity-0 transition peer-checked:opacity-100',
            indeterminate && 'opacity-100',
          )}
        />
      </div>
      {(label || description) && (
        <div className="flex flex-col">
          {label && <span className="text-sm font-medium text-fg-primary">{label}</span>}
          {description && <span className="text-xs text-fg-secondary">{description}</span>}
        </div>
      )}
    </label>
  );
}
