// shadcn catalog + the app primitive, per components/shadcn-bridge.md.
//
// CheckboxControl is the shadcn catalog copy, NORMALIZED: rounded-item
// corners, no default shadow, focus ring ring-2/offset-1 from --ring; the
// chrome check icon rides the fleet Icon primitive (mdi sprite), not lucide.
//
// Checkbox is the APP's labeled primitive, composed on CheckboxControl since
// the 2026-10-19 migration (it was a native <input type="checkbox">): the
// label/description anatomy and the indeterminate convenience prop stay, but
// the checked/onCheckedChange contract is Radix's (boolean delta, no native
// event) — call sites migrated in the same pass.
"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"

import { cn } from '../../lib/cn.js';
import { Icon } from './Icon.js';

const CheckboxControl = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, children, ...props }, ref) => (
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
      {children ?? <Icon name="mdi-check" size={12} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
CheckboxControl.displayName = CheckboxPrimitive.Root.displayName

interface CheckboxProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
    'checked' | 'onCheckedChange'
  > {
  label?: React.ReactNode;
  description?: React.ReactNode;
  indeterminate?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function Checkbox({
  label,
  description,
  className,
  id,
  indeterminate,
  checked,
  onCheckedChange,
  disabled,
  ...props
}: CheckboxProps) {
  // The labeled wrapper keeps the app's checkbox register (20px box,
  // outline border until checked); CheckboxControl's own catalog look is
  // for bare controls.
  return (
    <label
      htmlFor={id}
      className={cn(
        'group -m-3 flex cursor-pointer items-start gap-3 p-3',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <CheckboxControl
        id={id}
        disabled={disabled}
        checked={indeterminate ? 'indeterminate' : (checked ?? false)}
        onCheckedChange={(state) => onCheckedChange?.(state === true)}
        className="h-5 w-5 rounded-input border-outline bg-surface data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary"
        {...props}
      >
        <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
          <Icon name="mdi-check" size={14} className="text-on-primary" />
        </CheckboxPrimitive.Indicator>
      </CheckboxControl>
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
