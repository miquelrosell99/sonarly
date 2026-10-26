// shadcn catalog copy, NORMALIZED per components/shadcn-bridge.md — with the
// fleet text-field register (law/spec.md: the
// UNDERLINE field is the fleet default for labeled form fields (transparent,
// no box, a straight bottom hairline at rest; on focus a 2px accent
// underline — the underline IS the focus indicator, so the field opts out
// of the app-global focus ring). The BOXED variant is reserved for dense
// toolbar rows (search) and compact in-row edits, per the same ruling; call
// sites in those registers pass variant="boxed". The old 'input' marker
// class retired with the raw className="input" call sites and the .input
// block in index.css (migration 2026-10-19); number-input spinner removal
// is keyed on the type selector there.
import * as React from "react"

import { cn } from "@/lib/cn"

const variantClasses = {
  underline:
    "rounded-none border-0 border-b border-outline bg-transparent px-0 focus:border-b-2 focus:border-primary focus-visible:ring-0",
  boxed:
    "rounded-input border border-input bg-surface px-3 focus:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
} as const

export type InputVariant = keyof typeof variantClasses

const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { variant?: InputVariant }
>(({ className, type, variant = "underline", ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full text-sm text-foreground transition file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-on-surface-variant focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
