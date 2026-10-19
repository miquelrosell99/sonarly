// shadcn catalog + the app primitive, per components/shadcn-bridge.md.
//
// CheckboxControl is the shadcn catalog copy, NORMALIZED: rounded-item
// corners, no default shadow, focus ring ring-2/offset-1 from --ring; the
// chrome check icon rides the fleet Icon primitive (mdi sprite), not lucide.
//
// Checkbox is the APP's labeled primitive (the old components/ui/Checkbox):
// a native <input type="checkbox"> with label/description/indeterminate
// and the full InputHTMLAttributes contract — call sites rely on the native
// onChange event (e.target.checked) and form participation, which Radix's
// checked/onCheckedChange model does not preserve without churn, so it stays
// a native input. New code that needs a bare control composes
// CheckboxControl; migrating the labeled wrapper to it is a touch-point
// follow-up.
"use client"

import { useRef, useEffect } from 'react';
import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"

import { cn } from '../../lib/cn.js';
import { Icon } from './Icon.js';

const CheckboxControl = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "grid place-content-center peer h-4 w-4 shrink-0 rounded-item border border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("grid place-content-center text-current")}
    >
      <Icon name="mdi-check" size={12} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
CheckboxControl.displayName = CheckboxPrimitive.Root.displayName

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
            'absolute inset-0 rounded-input border border-outline bg-surface transition',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background',
            'peer-checked:border-primary peer-checked:bg-primary',
            indeterminate && 'border-primary bg-primary',
          )}
        />
        <Icon
          name="mdi-check"
          size={14}
          className={cn(
            'relative z-10 text-on-primary opacity-0 transition peer-checked:opacity-100',
            indeterminate && 'opacity-100',
          )}
        />
      </div>
      {(label || description) && (
        <div className="flex flex-col">
          {label && <span className="text-sm font-medium text-on-surface">{label}</span>}
          {description && <span className="text-xs text-on-surface-variant">{description}</span>}
        </div>
      )}
    </label>
  );
}

export { CheckboxControl };
